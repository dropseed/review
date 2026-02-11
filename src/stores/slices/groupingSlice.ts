import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import type {
  DiffHunk,
  FileSymbolDiff,
  GroupingInput,
  HunkGroup,
  HunkSymbolDef,
  HunkSymbolRef,
  ModifiedSymbolEntry,
  SummaryInput,
  SymbolDiff,
} from "../../types";
import { getChangedLinesKey } from "../../utils/changedLinesKey";

export type GuideTaskStatus = "idle" | "loading" | "done" | "error";

export interface GroupingSlice {
  groupingLoading: boolean;
  groupingError: string | null;
  reviewGroups: HunkGroup[];
  identicalHunkIds: Map<string, string[]>;
  isGroupingStale: () => boolean;
  generateGrouping: () => Promise<void>;
  clearGrouping: () => void;

  // Guide state
  guideLoading: boolean;
  guideSummary: string | null;
  guideSummaryError: string | null;
  classificationStatus: GuideTaskStatus;
  groupingStatus: GuideTaskStatus;
  summaryStatus: GuideTaskStatus;
  startGuide: () => Promise<void>;
  generateSummary: () => Promise<void>;
  clearGuideSummary: () => void;
  isSummaryStale: () => boolean;
  isGuideStale: () => boolean;
  restoreGuideFromState: () => void;
}

interface SymbolData {
  hunkDefines: Map<string, HunkSymbolDef[]>;
  hunkReferences: Map<string, HunkSymbolRef[]>;
  fileHasGrammar: Map<string, boolean>;
  modifiedSymbols: ModifiedSymbolEntry[];
}

/**
 * Walk a SymbolDiff tree, collecting per-hunk definitions and a global
 * glossary of modified symbols for the grouping prompt.
 */
function collectSymbolDefs(
  symbols: SymbolDiff[],
  filePath: string,
  hunkDefines: Map<string, HunkSymbolDef[]>,
  modifiedSymbols: ModifiedSymbolEntry[],
): void {
  for (const sym of symbols) {
    modifiedSymbols.push({
      name: sym.name,
      kind: sym.kind ?? undefined,
      changeType: sym.changeType,
      filePath,
    });

    for (const hunkId of sym.hunkIds) {
      const existing = hunkDefines.get(hunkId) ?? [];
      existing.push({
        name: sym.name,
        kind: sym.kind ?? undefined,
        changeType: sym.changeType,
      });
      hunkDefines.set(hunkId, existing);
    }

    collectSymbolDefs(sym.children, filePath, hunkDefines, modifiedSymbols);
  }
}

/**
 * Build per-hunk symbol annotations and a global glossary from FileSymbolDiff data.
 */
function buildSymbolData(symbolDiffs: FileSymbolDiff[]): SymbolData {
  const hunkDefines = new Map<string, HunkSymbolDef[]>();
  const hunkReferences = new Map<string, HunkSymbolRef[]>();
  const fileHasGrammar = new Map<string, boolean>();
  const modifiedSymbols: ModifiedSymbolEntry[] = [];

  for (const fileDiff of symbolDiffs) {
    fileHasGrammar.set(fileDiff.filePath, fileDiff.hasGrammar);
    collectSymbolDefs(
      fileDiff.symbols,
      fileDiff.filePath,
      hunkDefines,
      modifiedSymbols,
    );

    for (const ref of fileDiff.symbolReferences) {
      const existing = hunkReferences.get(ref.hunkId) ?? [];
      if (!existing.some((r) => r.name === ref.symbolName)) {
        existing.push({ name: ref.symbolName });
        hunkReferences.set(ref.hunkId, existing);
      }
    }
  }

  return { hunkDefines, hunkReferences, fileHasGrammar, modifiedSymbols };
}

/**
 * Group hunks by identical changed lines, returning a map from each hunk ID
 * to the IDs of other hunks with the same changes.
 */
function buildIdenticalHunkIds(hunks: DiffHunk[]): Map<string, string[]> {
  const keyToIds = new Map<string, string[]>();
  for (const hunk of hunks) {
    const key = getChangedLinesKey(hunk);
    if (!key) continue;
    const existing = keyToIds.get(key);
    if (existing) {
      existing.push(hunk.id);
    } else {
      keyToIds.set(key, [hunk.id]);
    }
  }

  const identicalHunkIds = new Map<string, string[]>();
  for (const [, ids] of keyToIds) {
    if (ids.length > 1) {
      for (const id of ids) {
        identicalHunkIds.set(
          id,
          ids.filter((other) => other !== id),
        );
      }
    }
  }
  return identicalHunkIds;
}

export const createGroupingSlice: SliceCreatorWithClient<GroupingSlice> =
  (client: ApiClient) => (set, get) => ({
    groupingLoading: false,
    groupingError: null,
    reviewGroups: [],
    identicalHunkIds: new Map(),

    // Guide state
    guideLoading: false,
    guideSummary: null,
    guideSummaryError: null,
    classificationStatus: "idle" as const,
    groupingStatus: "idle" as const,
    summaryStatus: "idle" as const,

    isGroupingStale: () => {
      const { reviewState, hunks } = get();
      const guide = reviewState?.guide;
      if (!guide) return false;

      const storedIds = new Set(guide.hunkIds);
      const currentIds = new Set(hunks.map((h) => h.id));

      if (storedIds.size !== currentIds.size) return true;
      for (const id of storedIds) {
        if (!currentIds.has(id)) return true;
      }
      return false;
    },

    startGuide: async () => {
      const {
        hunks,
        classifyUnlabeledHunks,
        generateGrouping,
        isGroupingStale,
        isSummaryStale,
        reviewGroups,
        guideSummary,
      } = get();
      if (hunks.length === 0) return;

      // Skip steps that already have fresh data
      const needsGrouping = reviewGroups.length === 0 || isGroupingStale();
      const needsSummary = guideSummary == null || isSummaryStale();

      // Collapse both sidebars to focus on the guide.
      // Use set() directly instead of setTabRailCollapsed/setFilesPanelCollapsed
      // so the collapse is in-memory only and doesn't persist to Tauri Store.
      set({
        tabRailCollapsed: true,
        filesPanelCollapsed: true,
        guideLoading: true,
        topLevelView: "guide",
        classificationStatus: "loading" as const,
        groupingStatus: needsGrouping
          ? ("loading" as const)
          : ("done" as const),
        summaryStatus: needsSummary ? ("loading" as const) : ("done" as const),
      });

      const wrap = (
        promise: Promise<void>,
        field: "classificationStatus" | "groupingStatus" | "summaryStatus",
      ) =>
        promise
          .then(() => set({ [field]: "done" as GuideTaskStatus }))
          .catch(() => set({ [field]: "error" as GuideTaskStatus }));

      const tasks: Promise<unknown>[] = [
        wrap(classifyUnlabeledHunks(), "classificationStatus"),
      ];
      if (needsGrouping) {
        tasks.push(wrap(generateGrouping(), "groupingStatus"));
      }
      if (needsSummary) {
        tasks.push(wrap(get().generateSummary(), "summaryStatus"));
      }

      await Promise.allSettled(tasks);

      set({ guideLoading: false });
    },

    generateSummary: async () => {
      const { repoPath, hunks, reviewState, classifyCommand, saveReviewState } =
        get();
      if (!repoPath || !reviewState) return;
      if (hunks.length === 0) return;

      set({ guideSummaryError: null });

      try {
        const summaryInputs: SummaryInput[] = hunks.map((hunk) => ({
          id: hunk.id,
          filePath: hunk.filePath,
          content: hunk.content,
          label: reviewState.hunks[hunk.id]?.label,
        }));

        const summary = await client.generateSummary(repoPath, summaryInputs, {
          command: classifyCommand || undefined,
        });

        const currentState = get().reviewState;
        if (!currentState) return;

        const updatedState = {
          ...currentState,
          guide: {
            groups: currentState.guide?.groups ?? [],
            hunkIds:
              currentState.guide?.hunkIds ?? hunks.map((h) => h.id).sort(),
            generatedAt:
              currentState.guide?.generatedAt ?? new Date().toISOString(),
            summary,
          },
          updatedAt: new Date().toISOString(),
        };

        set({
          reviewState: updatedState,
          guideSummary: summary,
        });
        await saveReviewState();
      } catch (err) {
        console.error("[generateSummary] Failed:", err);
        set({
          guideSummaryError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    clearGuideSummary: () => {
      const { reviewState, saveReviewState } = get();
      if (reviewState?.guide?.summary) {
        set({
          guideSummary: null,
          guideSummaryError: null,
          reviewState: {
            ...reviewState,
            guide: { ...reviewState.guide, summary: undefined },
            updatedAt: new Date().toISOString(),
          },
        });
        saveReviewState();
      } else {
        set({ guideSummary: null, guideSummaryError: null });
      }
    },

    isSummaryStale: () => {
      const { reviewState, hunks } = get();
      const guide = reviewState?.guide;
      if (!guide?.summary) return false;

      const storedIds = guide.hunkIds;
      const currentIds = hunks.map((h) => h.id).sort();
      if (storedIds.length !== currentIds.length) return true;
      for (let i = 0; i < storedIds.length; i++) {
        if (storedIds[i] !== currentIds[i]) return true;
      }
      return false;
    },

    isGuideStale: () => {
      const { isGroupingStale, isSummaryStale, isClassificationStale } = get();
      return isGroupingStale() || isSummaryStale() || isClassificationStale();
    },

    generateGrouping: async () => {
      const {
        repoPath,
        hunks,
        reviewState,
        classifyCommand,
        saveReviewState,
        symbolDiffs,
        symbolsLoaded,
      } = get();
      if (!repoPath || !reviewState) return;
      if (hunks.length === 0) return;

      set({ groupingLoading: true, groupingError: null });

      try {
        const { hunkDefines, hunkReferences, fileHasGrammar, modifiedSymbols } =
          symbolsLoaded && symbolDiffs.length > 0
            ? buildSymbolData(symbolDiffs)
            : {
                hunkDefines: new Map<string, HunkSymbolDef[]>(),
                hunkReferences: new Map<string, HunkSymbolRef[]>(),
                fileHasGrammar: new Map<string, boolean>(),
                modifiedSymbols: [] as ModifiedSymbolEntry[],
              };

        const groupingInputs: GroupingInput[] = hunks.map((hunk) => ({
          id: hunk.id,
          filePath: hunk.filePath,
          content: hunk.content,
          label: reviewState.hunks[hunk.id]?.label,
          symbols: hunkDefines.get(hunk.id),
          references: hunkReferences.get(hunk.id),
          hasGrammar: fileHasGrammar.get(hunk.filePath),
        }));

        const groups = await client.generateGrouping(repoPath, groupingInputs, {
          command: classifyCommand || undefined,
          modifiedSymbols:
            modifiedSymbols.length > 0 ? modifiedSymbols : undefined,
        });

        const identicalHunkIds = buildIdenticalHunkIds(hunks);

        const currentState = get().reviewState;
        if (!currentState) return;

        const updatedState = {
          ...currentState,
          guide: {
            groups,
            hunkIds: hunks.map((h) => h.id).sort(),
            generatedAt: new Date().toISOString(),
            summary: currentState.guide?.summary,
          },
          updatedAt: new Date().toISOString(),
        };

        set({
          reviewState: updatedState,
          reviewGroups: groups,
          identicalHunkIds,
          groupingLoading: false,
        });
        await saveReviewState();
      } catch (err) {
        console.error("[generateGrouping] Failed:", err);
        set({
          groupingLoading: false,
          groupingError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    clearGrouping: () => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      const updatedState = {
        ...reviewState,
        guide: undefined,
        updatedAt: new Date().toISOString(),
      };

      set({
        reviewState: updatedState,
        reviewGroups: [],
        identicalHunkIds: new Map(),
        guideSummary: null,
        guideSummaryError: null,
      });
      saveReviewState();
    },

    restoreGuideFromState: () => {
      const { reviewState, hunks, isGroupingStale } = get();
      const guide = reviewState?.guide;
      if (!guide) return;

      // Check staleness — if the hunk set has changed, don't restore
      if (isGroupingStale()) return;

      const identicalHunkIds = buildIdenticalHunkIds(hunks);
      set({
        reviewGroups: guide.groups,
        guideSummary: guide.summary ?? null,
        identicalHunkIds,
      });
    },
  });
