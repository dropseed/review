import { useMemo, useRef } from "react";
import { useReviewStore } from "../../stores";
import { ephemeralView } from "../../stores/selectors/ephemeral";
import { useAllHunks, useHunkIdsByStatus } from "../../stores/selectors/hunks";
import type { HunkGroup } from "../../types";

/**
 * The default content view's group: the comparison's needs-review hunks as
 * one rolling diff.
 *
 * Membership is a snapshot, not a live query — taken when the loaded review
 * comes on screen, fresh per visit (the ref dies with the default view, so
 * leaving for a file and coming back re-snapshots from what is pending
 * then). A live set would pull hunks out from under the reader the moment
 * they approve them; within a visit the snapshot keeps them in place wearing
 * their new status, which is what every other group surface (guide sections,
 * ad-hoc groups) does too. The key only exists to catch the comparison
 * changing under a mounted default view (a workspace switch, a base change).
 *
 * Two corrections do apply against the snapshot afterwards:
 * - Trusted hunks drop out. Static classification lands just after first
 *   load, so a fresh comparison's snapshot briefly counts hunks a trust
 *   pattern is about to absorb — their removal is the correction arriving,
 *   not the view changing its mind.
 * - Hunks no longer in the diff drop out, because membership is resolved by
 *   filtering the current hunks.
 *
 * Returns null when there is nothing to show: no comparison open (browse
 * mode, standalone), a commit being peeked at, a review whose snapshot had
 * nothing pending, or a diff still loading.
 */
export function useNeedsReviewDefaultGroup(): HunkGroup | null {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparisonKey = useReviewStore((s) => s.comparison?.key ?? null);
  const reviewState = useReviewStore((s) => s.reviewState);
  const loaded = useReviewStore((s) => s.loadingProgress === null);
  const isPeek = useReviewStore((s) => ephemeralView(s) !== null);

  const allHunks = useAllHunks();
  const byStatus = useHunkIdsByStatus();

  const applicable =
    repoPath !== null &&
    comparisonKey !== null &&
    !isPeek &&
    reviewState !== null;
  const key = `${repoPath}\n${comparisonKey}`;

  // Render-phase snapshot management (idempotent, so safe to re-run):
  // established once this review's diff has loaded, dropped as soon as it
  // stops being what's on screen.
  const snapshotRef = useRef<{ key: string; ids: Set<string> } | null>(null);
  if (!applicable) {
    snapshotRef.current = null;
  } else if (snapshotRef.current?.key !== key) {
    // A diff with no hunks never latches: a failed loadFiles also lands as
    // loaded-with-nothing (loadingProgress null, filesByPath empty), and a
    // latched empty snapshot froze "nothing pending" past every successful
    // retry — which only sets isRefreshing, never loadingProgress. Not
    // latching costs nothing here: an empty snapshot and no snapshot both
    // render null, so a genuinely change-free comparison looks the same.
    snapshotRef.current =
      loaded && allHunks.length > 0
        ? { key, ids: new Set(byStatus.pending) }
        : null;
  }
  const snapshot = snapshotRef.current;

  // Identity-stable across the store writes that don't change membership
  // (approvals, notes, comments): everything downstream of the group —
  // computeGroupFiles, the scroll-target key — re-derives on its identity.
  const lastGroupRef = useRef<HunkGroup | null>(null);
  return useMemo(() => {
    if (!snapshot) return (lastGroupRef.current = null);
    const trusted = new Set(byStatus.trusted);
    const hunkIds: string[] = [];
    for (const hunk of allHunks) {
      if (snapshot.ids.has(hunk.id) && !trusted.has(hunk.id)) {
        hunkIds.push(hunk.id);
      }
    }
    if (hunkIds.length === 0) return (lastGroupRef.current = null);
    const prev = lastGroupRef.current;
    if (
      prev &&
      prev.hunkIds.length === hunkIds.length &&
      hunkIds.every((id, i) => prev.hunkIds[i] === id)
    ) {
      return prev;
    }
    return (lastGroupRef.current = { title: "Needs review", hunkIds });
  }, [snapshot, allHunks, byStatus]);
}
