import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import type {
  DiffHunk,
  FileSymbolDiff,
  GroupingInput,
  GuideState,
  HunkGroup,
  HunkSymbolDef,
  HunkSymbolRef,
  ModifiedSymbolEntry,
  ReviewState,
  SummaryInput,
  SymbolDiff,
} from "../../types";
import { getChangedLinesKey } from "../../utils/changed-lines-key";

/** Singleton empty map -- preserves reference equality to avoid spurious re-renders. */
const EMPTY_IDENTICAL_MAP = new Map<string, string[]>();

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
  guideTitle: string | null;
  guideSummary: string | null;
  guideSummaryError: string | null;
  classificationStatus: GuideTaskStatus;
  groupingStatus: GuideTaskStatus;
  summaryStatus: GuideTaskStatus;
  startGuide: () => Promise<void>;
  exitGuide: () => void;
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
 * Build a SummaryInput array from the current hunks and review state.
 */
function buildSummaryInputs(
  hunks: DiffHunk[],
  hunkStates: Record<string, { label?: string[] }>,
): SummaryInput[] {
  return hunks.map((hunk) => ({
    id: hunk.id,
    filePath: hunk.filePath,
    content: hunk.content,
    label: hunkStates[hunk.id]?.label,
  }));
}

/**
 * Build an updated GuideState, preserving existing fields and applying overrides.
 */
function buildGuideUpdate(
  existing: GuideState | undefined,
  hunks: DiffHunk[],
  overrides: Partial<GuideState>,
): GuideState {
  return {
    groups: existing?.groups ?? [],
    hunkIds: existing?.hunkIds ?? hunks.map((h) => h.id).sort(),
    generatedAt: existing?.generatedAt ?? new Date().toISOString(),
    title: existing?.title,
    summary: existing?.summary,
    ...overrides,
  };
}

/**
 * Build an updated ReviewState with new guide data and a fresh timestamp.
 */
function updateReviewGuide(
  state: ReviewState,
  hunks: DiffHunk[],
  guideOverrides: Partial<GuideState>,
): ReviewState {
  return {
    ...state,
    guide: buildGuideUpdate(state.guide, hunks, guideOverrides),
    updatedAt: new Date().toISOString(),
  };
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

/** State that must be cleared when switching comparisons. */
export const groupingResetState = {
  groupingLoading: false,
  groupingError: null,
  reviewGroups: [],
  identicalHunkIds: EMPTY_IDENTICAL_MAP,
  guideLoading: false,
  guideTitle: null,
  guideSummary: null,
  guideSummaryError: null,
  classificationStatus: "idle",
  groupingStatus: "idle",
  summaryStatus: "idle",
} satisfies Partial<GroupingSlice>;

export const createGroupingSlice: SliceCreatorWithClient<GroupingSlice> =
  (client: ApiClient) => (set, get) => ({
    ...groupingResetState,

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
        comparison,
        classifyStaticHunks,
        generateGrouping,
        isGroupingStale,
        isSummaryStale,
        reviewGroups,
        guideSummary,
      } = get();
      if (hunks.length === 0) return;

      const comparisonKey = comparison.key;

      // Skip steps that already have fresh data
      const needsGrouping = reviewGroups.length === 0 || isGroupingStale();
      const needsSummary = guideSummary == null || isSummaryStale();

      // Switch to guide mode
      set({
        changesViewMode: "guide",
        selectedFile: null,
        guideContentMode: null,
        guideLoading: true,
        classificationStatus: "loading",
        groupingStatus: needsGrouping ? "loading" : "done",
        summaryStatus: needsSummary ? "loading" : "done",
      });

      const wrap = (
        promise: Promise<void>,
        field: "classificationStatus" | "groupingStatus" | "summaryStatus",
      ) =>
        promise
          .then(() => set({ [field]: "done" as GuideTaskStatus }))
          .catch(() => set({ [field]: "error" as GuideTaskStatus }));

      const tasks: Promise<unknown>[] = [
        wrap(classifyStaticHunks(), "classificationStatus"),
      ];
      if (needsGrouping) {
        tasks.push(wrap(generateGrouping(), "groupingStatus"));
      }
      if (needsSummary) {
        tasks.push(wrap(get().generateSummary(), "summaryStatus"));
      }

      await Promise.allSettled(tasks);

      if (get().comparison.key !== comparisonKey) return;
      set({ guideLoading: false });
    },

    exitGuide: () => {
      set({
        changesViewMode: "files",
        guideContentMode: null,
      });
    },

    generateSummary: async () => {
      const {
        repoPath,
        hunks,
        comparison,
        reviewState,
        saveReviewState,
        startActivity,
        endActivity,
      } = get();
      if (!repoPath || !reviewState) return;
      if (hunks.length === 0) return;

      const comparisonKey = comparison.key;

      const pr = reviewState.githubPr;
      const prTitle = pr?.title || null;
      const prBody = pr?.body || null;

      // If PR provides both title and body, use them directly and skip AI generation
      if (prTitle && prBody) {
        set({
          reviewState: updateReviewGuide(reviewState, hunks, {
            title: prTitle,
            summary: prBody,
          }),
          guideTitle: prTitle,
          guideSummary: prBody,
          summaryStatus: "done",
        });
        await saveReviewState();
        return;
      }

      set({
        guideSummaryError: null,
        summaryStatus: "loading",
      });
      startActivity("generate-summary", "Generating summary", 55);

      try {
        const summaryInputs = buildSummaryInputs(hunks, reviewState.hunks);
        const { title, summary } = await client.generateSummary(
          repoPath,
          summaryInputs,
        );

        const finalTitle = prTitle || title;
        const finalSummary = prBody || summary;

        if (get().comparison.key !== comparisonKey) return;
        const currentState = get().reviewState;
        if (!currentState) return;

        set({
          reviewState: updateReviewGuide(currentState, hunks, {
            title: finalTitle || undefined,
            summary: finalSummary,
          }),
          guideTitle: finalTitle || null,
          guideSummary: finalSummary,
          summaryStatus: "done",
        });
        await saveReviewState();
      } catch (err) {
        console.error("[generateSummary] Failed:", err);
        set({
          guideSummaryError: err instanceof Error ? err.message : String(err),
          summaryStatus: "error",
        });
      } finally {
        endActivity("generate-summary");
      }
    },

    clearGuideSummary: () => {
      const { reviewState, saveReviewState } = get();
      const hadPersistedData = reviewState?.guide?.summary;

      set({
        guideTitle: null,
        guideSummary: null,
        guideSummaryError: null,
        ...(hadPersistedData && {
          reviewState: {
            ...reviewState,
            guide: {
              ...reviewState!.guide!,
              title: undefined,
              summary: undefined,
            },
            updatedAt: new Date().toISOString(),
          },
        }),
      });

      if (hadPersistedData) {
        saveReviewState();
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
        comparison,
        reviewState,
        saveReviewState,
        symbolDiffs,
        symbolsLoaded,
        startActivity,
        endActivity,
      } = get();
      if (!repoPath || !reviewState) return;
      if (hunks.length === 0) return;

      const comparisonKey = comparison.key;

      set({ groupingLoading: true, groupingError: null });
      startActivity("generate-grouping", "Generating groups", 55);

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
          modifiedSymbols:
            modifiedSymbols.length > 0 ? modifiedSymbols : undefined,
        });

        if (get().comparison.key !== comparisonKey) return;

        const identicalHunkIds = buildIdenticalHunkIds(hunks);

        const currentState = get().reviewState;
        if (!currentState) return;

        set({
          reviewState: updateReviewGuide(currentState, hunks, {
            groups,
            hunkIds: hunks.map((h) => h.id).sort(),
            generatedAt: new Date().toISOString(),
          }),
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
      } finally {
        endActivity("generate-grouping");
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
        identicalHunkIds: EMPTY_IDENTICAL_MAP,
        guideTitle: null,
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
        guideTitle: guide.title ?? null,
        guideSummary: guide.summary ?? null,
        identicalHunkIds,
      });
    },
  });
