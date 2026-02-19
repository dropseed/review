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
  classificationStatus: GuideTaskStatus;
  groupingStatus: GuideTaskStatus;
  startGuide: () => Promise<void>;
  exitGuide: () => void;
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
  classificationStatus: "idle",
  groupingStatus: "idle",
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
        reviewGroups,
      } = get();
      if (hunks.length === 0) return;

      const comparisonKey = comparison.key;

      // Skip steps that already have fresh data
      const needsGrouping = reviewGroups.length === 0 || isGroupingStale();

      // Switch to guide mode
      set({
        changesViewMode: "guide",
        selectedFile: null,
        guideContentMode: null,
        guideLoading: true,
        classificationStatus: "loading",
        groupingStatus: needsGrouping ? "loading" : "done",
      });

      const wrap = (
        promise: Promise<void>,
        field: "classificationStatus" | "groupingStatus",
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

    isGuideStale: () => {
      const { isGroupingStale, isClassificationStale } = get();
      return isGroupingStale() || isClassificationStale();
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

      // Clear previous groups so streaming events start fresh
      set({ groupingLoading: true, groupingError: null, reviewGroups: [] });
      startActivity("generate-grouping", "Generating groups", 55);

      // Shared finalization: persist groups to review state and update store
      async function finalizeGroups(groups: HunkGroup[]): Promise<void> {
        const currentState = get().reviewState;
        if (!currentState) return;
        set({
          reviewState: updateReviewGuide(currentState, hunks, {
            groups,
            hunkIds: hunks.map((h) => h.id).sort(),
            generatedAt: new Date().toISOString(),
          }),
          reviewGroups: groups,
          identicalHunkIds: buildIdenticalHunkIds(hunks),
          groupingLoading: false,
        });
        await saveReviewState();
      }

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

        // Listen for streaming group events from Rust
        const unlisten = client.onGroupingGroup((group) => {
          if (get().comparison.key !== comparisonKey) return;
          set((prev) => {
            const update: Record<string, unknown> = {
              reviewGroups: [...prev.reviewGroups, group],
            };
            // Auto-activate the first group as soon as it arrives
            if (prev.reviewGroups.length === 0) {
              update.guideContentMode = "group";
              update.activeGroupIndex = 0;
            }
            return update;
          });
        });

        let groups: HunkGroup[];
        try {
          groups = await client.generateGrouping(repoPath, groupingInputs, {
            modifiedSymbols:
              modifiedSymbols.length > 0 ? modifiedSymbols : undefined,
          });
        } finally {
          unlisten();
        }

        if (get().comparison.key !== comparisonKey) return;

        // Persist the final groups (includes missing-hunk fallback group)
        await finalizeGroups(groups);
      } catch (err) {
        console.error("[generateGrouping] Failed:", err);

        // If streaming delivered groups before the invoke failed (e.g. timeout),
        // treat them as a usable result instead of showing an error.
        const streamedGroups = get().reviewGroups;
        if (
          streamedGroups.length > 0 &&
          get().comparison.key === comparisonKey
        ) {
          await finalizeGroups(streamedGroups);
          return;
        }

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
        identicalHunkIds,
      });
    },
  });
