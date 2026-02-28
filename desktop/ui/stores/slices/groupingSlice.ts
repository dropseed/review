import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import type {
  DiffHunk,
  FileSymbolDiff,
  GroupingInput,
  GuideGenerated,
  HunkGroup,
  HunkSymbolDef,
  HunkSymbolRef,
  ModifiedSymbolEntry,
  ReviewState,
  SymbolDiff,
} from "../../types";
import { isHunkTrusted } from "../../types";
import { getChangedLinesKey } from "../../utils/changed-lines-key";
import { playGuideStartSound } from "../../utils/sounds";

/** Singleton empty map -- preserves reference equality to avoid spurious re-renders. */
const EMPTY_IDENTICAL_MAP = new Map<string, string[]>();

export type GuideTaskStatus = "idle" | "loading" | "done" | "error";

/** Per-review grouping state stored in the keyed Map. */
export interface GroupingEntry {
  reviewGroups: HunkGroup[];
  groupingLoading: boolean;
  groupingError: string | null;
  groupingStatus: GuideTaskStatus;
  groupingPartialTitle: string | null;
  /** Active request ID for cancellation support. */
  groupingRequestId: string | null;
  identicalHunkIds: Map<string, string[]>;
  guideLoading: boolean;
  classificationStatus: GuideTaskStatus;
}

/** Frozen singleton for stable selector references when no entry exists. */
const EMPTY_ENTRY: GroupingEntry = Object.freeze({
  reviewGroups: [],
  groupingLoading: false,
  groupingError: null,
  groupingStatus: "idle",
  groupingPartialTitle: null,
  groupingRequestId: null,
  identicalHunkIds: EMPTY_IDENTICAL_MAP,
  guideLoading: false,
  classificationStatus: "idle",
});

/** Build a unique key for a review (repo + comparison). */
export function makeReviewKey(repoPath: string, comparisonKey: string): string {
  return `${repoPath}:${comparisonKey}`;
}

/** Immutable Map update helper: applies `updater` to the entry at `key`. */
function updateGroupingEntry(
  map: Map<string, GroupingEntry>,
  key: string,
  updater: (entry: GroupingEntry) => GroupingEntry,
): Map<string, GroupingEntry> {
  const existing = map.get(key) ?? EMPTY_ENTRY;
  const updated = updater(existing);
  const next = new Map(map);
  next.set(key, updated);
  return next;
}

/** Describes how stale the current grouping is relative to on-disk guide. */
export interface GroupingStaleness {
  stale: boolean;
  added: number;
  removed: number;
}

export interface GroupingSlice {
  groupingStates: Map<string, GroupingEntry>;
  getActiveGroupingEntry: () => GroupingEntry;
  isReviewBusy: (reviewKey: string) => boolean;
  removeGroupingEntry: (reviewKey: string) => void;

  isGroupingStale: () => boolean;
  getGroupingStaleness: () => GroupingStaleness;
  generateGrouping: () => Promise<void>;
  cancelGrouping: () => void;
  clearGrouping: () => void;

  /** When true, exclude already-approved/rejected hunks from grouping (useful for iteration reviews). */
  excludeReviewedFromGrouping: boolean;
  setExcludeReviewedFromGrouping: (value: boolean) => void;

  // Guide state
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
 * Build an updated GuideGenerated, preserving existing fields and applying overrides.
 */
function buildGuideGenerated(
  existing: GuideGenerated | undefined,
  hunks: DiffHunk[],
  overrides: Partial<GuideGenerated>,
): GuideGenerated {
  return {
    groups: existing?.groups ?? [],
    hunkIds: existing?.hunkIds ?? hunks.map((h) => h.id).sort(),
    generatedAt: existing?.generatedAt ?? new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build an updated ReviewState with new guide generated data and a fresh timestamp.
 * Preserves guide-level config (autoStart) while updating the generated state.
 */
function updateReviewGuide(
  state: ReviewState,
  hunks: DiffHunk[],
  guideOverrides: Partial<GuideGenerated>,
): ReviewState {
  return {
    ...state,
    guide: {
      ...state.guide,
      state: buildGuideGenerated(state.guide?.state, hunks, guideOverrides),
    },
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

/**
 * Patch stale groups: remove vanished hunk IDs, drop empty groups,
 * and bucket new hunk IDs into an ungrouped catchall at the end.
 */
function patchStaleGroups(
  groups: HunkGroup[],
  currentHunkIds: Set<string>,
): HunkGroup[] {
  const seenIds = new Set<string>();

  // Filter vanished IDs from each group, drop groups that become empty
  const patched: HunkGroup[] = [];
  for (const group of groups) {
    const filtered = group.hunkIds.filter((id) => currentHunkIds.has(id));
    for (const id of filtered) seenIds.add(id);
    if (filtered.length > 0) {
      patched.push(
        filtered.length === group.hunkIds.length
          ? group
          : { ...group, hunkIds: filtered },
      );
    }
  }

  // Bucket any new IDs into an ungrouped catchall
  const newIds: string[] = [];
  for (const id of currentHunkIds) {
    if (!seenIds.has(id)) newIds.push(id);
  }
  if (newIds.length > 0) {
    patched.push({
      title: "Other changes",
      hunkIds: newIds,
      ungrouped: true,
    });
  }

  return patched;
}

/** Monotonic counter used to generate unique request IDs for streaming event scoping. */
let groupingNonce = 0;

export const createGroupingSlice: SliceCreatorWithClient<GroupingSlice> =
  (client: ApiClient) => (set, get) => ({
    groupingStates: new Map(),
    excludeReviewedFromGrouping: false,
    setExcludeReviewedFromGrouping: (value: boolean) =>
      set({ excludeReviewedFromGrouping: value }),

    getActiveGroupingEntry: () => {
      const { repoPath, comparison, groupingStates } = get();
      if (!repoPath) return EMPTY_ENTRY;
      const key = makeReviewKey(repoPath, comparison.key);
      return groupingStates.get(key) ?? EMPTY_ENTRY;
    },

    isReviewBusy: (reviewKey: string) => {
      const entry = get().groupingStates.get(reviewKey);
      return entry?.groupingLoading ?? false;
    },

    removeGroupingEntry: (reviewKey: string) => {
      set((prev) => {
        if (!prev.groupingStates.has(reviewKey)) return prev;
        const next = new Map(prev.groupingStates);
        next.delete(reviewKey);
        return { groupingStates: next };
      });
    },

    isGroupingStale: () => {
      return get().getGroupingStaleness().stale;
    },

    getGroupingStaleness: () => {
      const { reviewState, hunks } = get();
      const generated = reviewState?.guide?.state;
      if (!generated) return { stale: false, added: 0, removed: 0 };

      const storedIds = new Set(generated.hunkIds);
      const currentIds = new Set(hunks.map((h) => h.id));

      let added = 0;
      let removed = 0;
      for (const id of currentIds) {
        if (!storedIds.has(id)) added++;
      }
      for (const id of storedIds) {
        if (!currentIds.has(id)) removed++;
      }
      return { stale: added > 0 || removed > 0, added, removed };
    },

    startGuide: async () => {
      const {
        hunks,
        comparison,
        repoPath,
        classifyStaticHunks,
        generateGrouping,
        restoreGuideFromState,
        getActiveGroupingEntry,
        isReviewBusy,
      } = get();
      if (hunks.length === 0 || !repoPath) return;

      const comparisonKey = comparison.key;
      const reviewKey = makeReviewKey(repoPath, comparisonKey);

      // Restore from disk if no groups in memory.
      // restoreGuideFromState handles staleness patching internally —
      // it removes vanished hunks and buckets new ones into a catchall group.
      if (getActiveGroupingEntry().reviewGroups.length === 0) {
        restoreGuideFromState();
      }

      const groupingInFlight = isReviewBusy(reviewKey);
      const entry = getActiveGroupingEntry();
      const needsGrouping =
        !groupingInFlight &&
        (entry.reviewGroups.length === 0 || get().isGroupingStale());
      const groupingPending = needsGrouping || groupingInFlight;

      // Switch to guide mode + update keyed entry
      const groupingStatus: GuideTaskStatus = groupingPending
        ? "loading"
        : "done";
      set((prev) => ({
        changesViewMode: "guide",
        selectedFile: null,
        guideContentMode: null,
        groupingStates: updateGroupingEntry(
          prev.groupingStates,
          reviewKey,
          (e) => ({
            ...e,
            guideLoading: true,
            classificationStatus: "loading" as GuideTaskStatus,
            groupingStatus,
            groupingLoading: groupingInFlight || e.groupingLoading,
          }),
        ),
      }));

      /** Set a task status field in the keyed entry. */
      const setTaskStatus = (
        field: "classificationStatus" | "groupingStatus",
        value: GuideTaskStatus,
      ): void => {
        set((prev) => ({
          groupingStates: updateGroupingEntry(
            prev.groupingStates,
            reviewKey,
            (e) => ({ ...e, [field]: value }),
          ),
        }));
      };

      /** Run a task and update its status field to "done" or "error". */
      const trackTask = (
        promise: Promise<void>,
        field: "classificationStatus" | "groupingStatus",
      ): Promise<void> =>
        promise
          .then(() => setTaskStatus(field, "done"))
          .catch(() => setTaskStatus(field, "error"));

      const tasks: Promise<unknown>[] = [
        trackTask(classifyStaticHunks(), "classificationStatus"),
      ];
      if (needsGrouping) {
        tasks.push(trackTask(generateGrouping(), "groupingStatus"));
      }

      await Promise.allSettled(tasks);

      // Mark guide loading complete in the keyed entry
      set((prev) => ({
        groupingStates: updateGroupingEntry(
          prev.groupingStates,
          reviewKey,
          (e) => ({ ...e, guideLoading: false }),
        ),
      }));
    },

    exitGuide: () => {
      const { repoPath, comparison } = get();
      set({ changesViewMode: "files", guideContentMode: null });
      // Clear guideLoading so the button isn't stuck in "Starting…" state
      // if the user exits while startGuide is still awaiting tasks.
      if (repoPath) {
        const key = makeReviewKey(repoPath, comparison.key);
        set((prev) => ({
          groupingStates: updateGroupingEntry(prev.groupingStates, key, (e) =>
            e.guideLoading ? { ...e, guideLoading: false } : e,
          ),
        }));
      }
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

      // Narrow repoPath for closures (TypeScript doesn't track the null guard above)
      const repo: string = repoPath;
      const comparisonKey = comparison.key;
      const reviewKey = makeReviewKey(repoPath, comparisonKey);

      // Skip if already running for this review
      if (get().isReviewBusy(reviewKey)) return;

      // Unique request ID scopes Tauri streaming events to this invocation,
      // preventing cross-talk when multiple reviews have concurrent groupings.
      const requestId = String(++groupingNonce);

      // Scope the activity ID to this review so concurrent groupings
      // for different reviews don't collide in the activity bar.
      const activityId = `generate-grouping:${reviewKey}`;

      playGuideStartSound();

      // Clear previous groups so streaming events start fresh
      set((prev) => ({
        groupingStates: updateGroupingEntry(
          prev.groupingStates,
          reviewKey,
          (e) => ({
            ...e,
            groupingLoading: true,
            groupingError: null,
            groupingRequestId: requestId,
            reviewGroups: [],
          }),
        ),
      }));
      startActivity(activityId, "Generating groups", 55);

      // Persist groups to review state and update the keyed entry
      async function finalizeGroups(groups: HunkGroup[]): Promise<void> {
        const guideOverrides: Partial<GuideGenerated> = {
          groups,
          hunkIds: hunks.map((h) => h.id).sort(),
          generatedAt: new Date().toISOString(),
        };

        // Always update the keyed entry
        set((prev) => ({
          groupingStates: updateGroupingEntry(
            prev.groupingStates,
            reviewKey,
            (e) => ({
              ...e,
              reviewGroups: groups,
              identicalHunkIds: buildIdenticalHunkIds(hunks),
              groupingLoading: false,
              groupingStatus: "done",
              groupingPartialTitle: null,
              groupingRequestId: null,
            }),
          ),
        }));

        // Persist to disk
        if (get().comparison.key === comparisonKey && get().repoPath === repo) {
          // Still on same review — use the normal save path
          const currentState = get().reviewState;
          if (!currentState) return;
          set({
            reviewState: updateReviewGuide(currentState, hunks, guideOverrides),
          });
          await saveReviewState();
        } else {
          // Navigated away — save directly to disk
          try {
            const diskState = await client.loadReviewState(repo, comparison);
            const updatedState = updateReviewGuide(
              diskState,
              hunks,
              guideOverrides,
            );
            await client.saveReviewState(repo, updatedState);
          } catch (saveErr) {
            console.error(
              "[generateGrouping] Background save failed:",
              saveErr,
            );
          }
        }
      }

      try {
        const { hunkDefines, hunkReferences, fileHasGrammar, modifiedSymbols } =
          buildSymbolData(symbolsLoaded ? symbolDiffs : []);

        // Always exclude trusted hunks (auto-approved via trust list patterns).
        // Optionally also exclude explicitly approved/rejected hunks (useful
        // when re-reviewing iterations where some hunks are already handled).
        const { trustList, hunks: hunkStates } = reviewState;
        const excludeReviewed = get().excludeReviewedFromGrouping;
        const filteredHunks = hunks.filter((hunk) => {
          const state = hunkStates[hunk.id];
          if (isHunkTrusted(state, trustList)) return false;
          if (
            excludeReviewed &&
            (state?.status === "approved" || state?.status === "rejected")
          )
            return false;
          return true;
        });

        if (filteredHunks.length < hunks.length) {
          console.log(
            `[generateGrouping] Excluded ${hunks.length - filteredHunks.length} hunks (${filteredHunks.length} remaining, excludeReviewed=${excludeReviewed})`,
          );
        }

        const groupingInputs: GroupingInput[] = filteredHunks.map((hunk) => ({
          id: hunk.id,
          filePath: hunk.filePath,
          content: hunk.content,
          label: hunkStates[hunk.id]?.label,
          symbols: hunkDefines.get(hunk.id),
          references: hunkReferences.get(hunk.id),
          hasGrammar: fileHasGrammar.get(hunk.filePath),
        }));

        // Stream events from Rust; scoped to this requestId so concurrent groupings don't cross-talk
        const unlisten = client.onGroupingEvent(requestId, (event) => {
          if (event.type === "group") {
            set((prev) => {
              const entry = prev.groupingStates.get(reviewKey) ?? EMPTY_ENTRY;
              const isFirstGroup = entry.reviewGroups.length === 0;
              const newEntry: GroupingEntry = {
                ...entry,
                reviewGroups: [...entry.reviewGroups, event],
                groupingPartialTitle: null,
              };
              const updated = new Map(prev.groupingStates);
              updated.set(reviewKey, newEntry);

              // Auto-activate the first group only if still on same review
              const isStillActive =
                prev.comparison.key === comparisonKey && prev.repoPath === repo;
              return {
                groupingStates: updated,
                ...(isFirstGroup &&
                  isStillActive && {
                    guideContentMode: "group",
                    activeGroupIndex: 0,
                  }),
              };
            });
          } else if (event.type === "partialTitle") {
            set((prev) => ({
              groupingStates: updateGroupingEntry(
                prev.groupingStates,
                reviewKey,
                (e) => ({ ...e, groupingPartialTitle: event.title }),
              ),
            }));
          }
        });

        let groups: HunkGroup[];
        try {
          groups = await client.generateGrouping(repo, groupingInputs, {
            modifiedSymbols:
              modifiedSymbols.length > 0 ? modifiedSymbols : undefined,
            requestId,
          });
        } finally {
          unlisten();
        }

        // Persist the final groups (includes missing-hunk fallback group)
        await finalizeGroups(groups);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isCancelled = errMsg === "Cancelled";

        if (!isCancelled) {
          console.error("[generateGrouping] Failed:", err);
        }

        // If streaming delivered groups before the invoke failed (e.g. timeout
        // or cancellation), treat them as a usable result instead of showing an error.
        const entry = get().groupingStates.get(reviewKey);
        const streamedGroups = entry?.reviewGroups ?? [];
        if (streamedGroups.length > 0) {
          await finalizeGroups(streamedGroups);
          return;
        }

        set((prev) => ({
          groupingStates: updateGroupingEntry(
            prev.groupingStates,
            reviewKey,
            (e) => ({
              ...e,
              groupingLoading: false,
              groupingRequestId: null,
              // Don't show an error for user-initiated cancellation
              groupingError: isCancelled ? null : errMsg,
            }),
          ),
        }));
      } finally {
        endActivity(activityId);
      }
    },

    cancelGrouping: () => {
      const { repoPath, comparison, groupingStates } = get();
      if (!repoPath) return;
      const reviewKey = makeReviewKey(repoPath, comparison.key);
      const requestId = groupingStates.get(reviewKey)?.groupingRequestId;
      if (!requestId) return;

      client.cancelGrouping(requestId);
    },

    clearGrouping: () => {
      const { repoPath, comparison, reviewState, saveReviewState } = get();
      if (!reviewState || !repoPath) return;

      const reviewKey = makeReviewKey(repoPath, comparison.key);
      // Preserve guide-level config (autoStart) while clearing generated state
      const updatedState = {
        ...reviewState,
        guide: reviewState.guide
          ? { autoStart: reviewState.guide.autoStart }
          : undefined,
        updatedAt: new Date().toISOString(),
      };

      set((prev) => {
        const next = new Map(prev.groupingStates);
        next.delete(reviewKey);
        return { reviewState: updatedState, groupingStates: next };
      });
      saveReviewState();
    },

    restoreGuideFromState: () => {
      const { reviewState, hunks, isGroupingStale, repoPath, comparison } =
        get();
      if (!repoPath) return;
      const generated = reviewState?.guide?.state;
      if (!generated || generated.groups.length === 0) return;

      // If stale, patch the stored groups (remove vanished IDs, bucket new ones)
      // instead of discarding them entirely.
      const groups = isGroupingStale()
        ? patchStaleGroups(generated.groups, new Set(hunks.map((h) => h.id)))
        : generated.groups;

      const reviewKey = makeReviewKey(repoPath, comparison.key);
      set((prev) => ({
        groupingStates: updateGroupingEntry(
          prev.groupingStates,
          reviewKey,
          (e) => ({
            ...e,
            reviewGroups: groups,
            identicalHunkIds: buildIdenticalHunkIds(hunks),
          }),
        ),
      }));
    },
  });
