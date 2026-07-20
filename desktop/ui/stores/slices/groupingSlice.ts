import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import { getAllHunksFromState } from "../selectors/hunks";
import type { HunkGroup } from "../../types";

/** Per-review guide state stored in the keyed Map. */
export interface GroupingEntry {
  reviewGroups: HunkGroup[];
}

/** Frozen singleton for stable selector references when no entry exists. */
const EMPTY_ENTRY: GroupingEntry = Object.freeze({
  reviewGroups: [],
});

/** Build a unique key for a review (repo + ref). Matches the backend's
 *  freshness key `${repo_path}:${ref}`. */
export function makeReviewKey(repoPath: string, ref: string): string {
  return `${repoPath}:${ref}`;
}

/** Stable empty result so callers can use this in selectors/memos. */
const NO_MISSING_REFS: string[] = [];

/**
 * The deleted refs (base/compare branches that no longer resolve) recorded for
 * a review by the freshness check. Returns a stable empty array when the review
 * ref is unset or all its refs resolve. Shared by every consumer of the "this
 * review's branch is gone" signal (review view, keyboard nav, tab rail).
 */
export function getMissingRefs(
  reviewMissingRefs: Record<string, string[]>,
  repoPath: string | null,
  reviewRef: string | null,
): string[] {
  if (!repoPath || !reviewRef) return NO_MISSING_REFS;
  return (
    reviewMissingRefs[makeReviewKey(repoPath, reviewRef)] ?? NO_MISSING_REFS
  );
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

/** Describes how stale the in-app guide is relative to the current diff. */
export interface GroupingStaleness {
  stale: boolean;
  added: number;
  removed: number;
}

export interface GroupingSlice {
  groupingStates: Map<string, GroupingEntry>;
  getActiveGroupingEntry: () => GroupingEntry;
  removeGroupingEntry: (reviewKey: string) => void;
  migrateGroupingEntry: (oldKey: string, newKey: string) => void;

  isGroupingStale: () => boolean;
  getGroupingStaleness: () => GroupingStaleness;
  /** Discard the guide from this review (and disk). */
  clearGrouping: () => void;

  restoreGuideFromState: () => void;
}

/**
 * Patch stale groups: remove vanished hunk IDs, drop empty groups, and bucket
 * any new hunk IDs into an ungrouped catchall at the end. Mirrors the CLI's
 * `guide show` reconciliation so the app and CLI agree on what a guide covers.
 */
function patchStaleGroups(
  groups: HunkGroup[],
  currentHunkIds: Set<string>,
): HunkGroup[] {
  const seenIds = new Set<string>();

  // Filter vanished IDs from each group, drop groups that become empty.
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

  // Bucket any new IDs into an ungrouped catchall.
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

export const createGroupingSlice: SliceCreatorWithClient<GroupingSlice> =
  (_client: ApiClient) => (set, get) => ({
    groupingStates: new Map(),

    getActiveGroupingEntry: () => {
      const { repoPath, reviewRef, groupingStates } = get();
      if (!repoPath || !reviewRef) return EMPTY_ENTRY;
      const key = makeReviewKey(repoPath, reviewRef);
      return groupingStates.get(key) ?? EMPTY_ENTRY;
    },

    removeGroupingEntry: (reviewKey: string) => {
      set((prev) => {
        if (!prev.groupingStates.has(reviewKey)) return prev;
        const next = new Map(prev.groupingStates);
        next.delete(reviewKey);
        return { groupingStates: next };
      });
    },

    migrateGroupingEntry: (oldKey: string, newKey: string) => {
      set((prev) => {
        const entry = prev.groupingStates.get(oldKey);
        if (!entry) return prev;
        const next = new Map(prev.groupingStates);
        next.delete(oldKey);
        next.set(newKey, entry);
        return { groupingStates: next };
      });
    },

    isGroupingStale: () => {
      return get().getGroupingStaleness().stale;
    },

    getGroupingStaleness: () => {
      const { reviewState } = get();
      const generated = reviewState?.guide?.state;
      if (!generated) return { stale: false, added: 0, removed: 0 };

      const hunks = getAllHunksFromState(get());
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

    clearGrouping: () => {
      const { repoPath, reviewRef, reviewState, saveReviewState } = get();
      if (!reviewState || !repoPath || !reviewRef) return;

      const reviewKey = makeReviewKey(repoPath, reviewRef);
      const updatedState = {
        ...reviewState,
        guide: undefined,
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
      const { reviewState, isGroupingStale, repoPath, reviewRef } = get();
      if (!repoPath || !reviewRef) return;
      const hunks = getAllHunksFromState(get());
      const generated = reviewState?.guide?.state;
      if (!generated || generated.groups.length === 0) return;

      // If stale, patch the stored groups (remove vanished IDs, bucket new ones)
      // instead of discarding them entirely.
      const groups = isGroupingStale()
        ? patchStaleGroups(generated.groups, new Set(hunks.map((h) => h.id)))
        : generated.groups;

      const reviewKey = makeReviewKey(repoPath, reviewRef);
      set((prev) => ({
        groupingStates: updateGroupingEntry(
          prev.groupingStates,
          reviewKey,
          (e) => ({ ...e, reviewGroups: groups }),
        ),
      }));
    },
  });
