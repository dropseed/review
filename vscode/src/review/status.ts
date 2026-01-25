/**
 * Review status computation.
 * Ported from Python human_review/review.py
 */

import type { ChangedFile, HunkState, ReviewState } from "../state/types";
import { patternsMatchTrustList } from "../trust/matching";
import { getHunkKey } from "../utils/hash";

/**
 * Check if hunk's labels are all trusted.
 */
export function isHunkTrusted(hunk: HunkState, effectiveTrust: string[]): boolean {
  if (!hunk.label || hunk.label.length === 0) {
    return false; // No labels = needs review
  }
  const { allTrusted } = patternsMatchTrustList(hunk.label, effectiveTrust);
  return allTrusted;
}

/**
 * Check if a hunk is approved (via review or trust).
 */
export function isHunkApproved(hunk: HunkState, effectiveTrust: string[]): boolean {
  if (hunk.approved_via === "review") {
    return true;
  }
  return isHunkTrusted(hunk, effectiveTrust);
}

/**
 * Get the display label for a hunk (reasoning text).
 */
export function getHunkDisplayLabel(hunkState: HunkState | undefined): string | null {
  if (!hunkState) return null;
  return hunkState.reasoning;
}

/**
 * Computed review status for display.
 */
export interface ReviewStatus {
  comparisonKey: string;
  totalFiles: number;
  totalHunks: number;
  approvedHunks: number;
  unlabeledCount: number;
  byFileStatus: Record<string, { files: number; hunks: number }>;
  /** Unreviewed hunks grouped by label, sorted by count desc */
  unreviewedByLabel: Array<{ label: string; count: number }>;
  /** Trusted hunks grouped by label, sorted by count desc */
  trustedByLabel: Array<{ label: string; count: number }>;
  /** Reviewed hunks grouped by label, sorted by count desc */
  reviewedByLabel: Array<{ label: string; count: number }>;
}

/**
 * Computed status with convenience getters.
 */
export interface ReviewStatusWithProgress extends ReviewStatus {
  progressPercent: number;
  remainingHunks: number;
  unreviewedTotal: number;
  trustedTotal: number;
  reviewedTotal: number;
}

/**
 * Compute review status from files and state.
 */
export function computeReviewStatus(
  files: ChangedFile[],
  state: ReviewState,
  comparisonKey: string,
  effectiveTrust?: string[],
): ReviewStatusWithProgress {
  const trust = effectiveTrust ?? [...state.trust_label];

  let totalHunks = 0;
  let approvedHunks = 0;
  let unlabeledTotal = 0;

  // Labeled but not trusted (has labels but not all trusted)
  const unreviewedByLabel: Record<string, number> = {};
  // Trusted hunks grouped by label (computed: all labels in trust list)
  const trustedByLabel: Record<string, number> = {};
  // Reviewed hunks grouped by label (approved_via == "review")
  const reviewedByLabel: Record<string, number> = {};

  // Track files by git status
  const byFileStatus: Record<string, { files: number; hunks: number }> = {};
  const totalFiles = files.length;

  for (const f of files) {
    // Track by file status
    if (!(f.status in byFileStatus)) {
      byFileStatus[f.status] = { files: 0, hunks: 0 };
    }
    byFileStatus[f.status].files += 1;
    byFileStatus[f.status].hunks += f.hunks.length;

    for (const hunk of f.hunks) {
      totalHunks += 1;
      const hunkKey = getHunkKey(hunk.filePath, hunk.hash);
      const hunkState = state.hunks[hunkKey];

      if (hunkState && hunkState.approved_via === "review") {
        // Manually reviewed
        approvedHunks += 1;
        const reasoning = hunkState.reasoning || "(no reasoning)";
        reviewedByLabel[reasoning] = (reviewedByLabel[reasoning] || 0) + 1;
      } else if (hunkState && isHunkTrusted(hunkState, trust)) {
        // Trusted (computed dynamically)
        approvedHunks += 1;
        const reasoning = hunkState.reasoning || "(no reasoning)";
        trustedByLabel[reasoning] = (trustedByLabel[reasoning] || 0) + 1;
      } else if (hunkState && (hunkState.label.length > 0 || hunkState.reasoning !== null)) {
        // Has labels or reasoning but not trusted
        const reasoning = hunkState.reasoning || "(no reasoning)";
        unreviewedByLabel[reasoning] = (unreviewedByLabel[reasoning] || 0) + 1;
      } else {
        // No labels or reasoning
        unlabeledTotal += 1;
      }
    }
  }

  // Sort by count descending
  const sortByCount = (obj: Record<string, number>): Array<{ label: string; count: number }> =>
    Object.entries(obj)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

  const unreviewedSorted = sortByCount(unreviewedByLabel);
  const trustedSorted = sortByCount(trustedByLabel);
  const reviewedSorted = sortByCount(reviewedByLabel);

  const progressPercent = totalHunks === 0 ? 0 : Math.round((approvedHunks / totalHunks) * 100);
  const remainingHunks = totalHunks - approvedHunks;
  const unreviewedTotal = unreviewedSorted.reduce((sum, item) => sum + item.count, 0);
  const trustedTotal = trustedSorted.reduce((sum, item) => sum + item.count, 0);
  const reviewedTotal = reviewedSorted.reduce((sum, item) => sum + item.count, 0);

  return {
    comparisonKey,
    totalFiles,
    totalHunks,
    approvedHunks,
    unlabeledCount: unlabeledTotal,
    byFileStatus,
    unreviewedByLabel: unreviewedSorted,
    trustedByLabel: trustedSorted,
    reviewedByLabel: reviewedSorted,
    progressPercent,
    remainingHunks,
    unreviewedTotal,
    trustedTotal,
    reviewedTotal,
  };
}

/**
 * Count how many times each hunk key appears in the file list.
 */
export function countHunksByKey(files: ChangedFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    for (const hunk of f.hunks) {
      const key = getHunkKey(hunk.filePath, hunk.hash);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Get set of all valid hunk keys from current diff.
 */
export function getValidHunkKeys(files: ChangedFile[]): Set<string> {
  return new Set(countHunksByKey(files).keys());
}
