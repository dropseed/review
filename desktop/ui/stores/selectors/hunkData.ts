import { effectiveHunkStatus, EMPTY_TRUST_LIST } from "../../types";
import type { DiffHunk, FileDiff, ReviewState } from "../../types";

/**
 * Derived views over hunk state, as plain functions.
 *
 * Kept apart from the hook module because slices need these too, and a slice
 * importing the hooks would pull in the assembled store — which imports the
 * slices. That cycle resolved by luck of import order until something imported
 * a slice before the store.
 */

// Module-level caches keyed on `filesByPath` (and `flatFileList` for the
// ordered flat list). Multiple subscribers share the same cached output, so
// the underlying flatten / Map-build runs once per actual state change rather
// than once per subscriber-render.

let allHunksCache: {
  filesByPath: Record<string, FileDiff>;
  flatFileList: string[];
  output: DiffHunk[];
} | null = null;

let hunkByIdCache: {
  filesByPath: Record<string, FileDiff>;
  output: Map<string, DiffHunk>;
} | null = null;

let hunkLocationCache: {
  filesByPath: Record<string, FileDiff>;
  output: Map<string, { filePath: string; indexInFile: number }>;
} | null = null;

/**
 * Flat hunks list in `flatFileList` order. Cached on input identity so all
 * call sites (slice internals + React subscribers) share the same array.
 */
export function getAllHunksFromState(state: {
  filesByPath: Record<string, FileDiff>;
  flatFileList: string[];
}): DiffHunk[] {
  if (
    allHunksCache &&
    allHunksCache.filesByPath === state.filesByPath &&
    allHunksCache.flatFileList === state.flatFileList
  ) {
    return allHunksCache.output;
  }
  const out: DiffHunk[] = [];
  const seen = new Set<string>();
  for (const path of state.flatFileList) {
    const fd = state.filesByPath[path];
    if (fd) {
      out.push(...fd.hunks);
      seen.add(path);
    }
  }
  for (const [path, fd] of Object.entries(state.filesByPath)) {
    if (!seen.has(path)) out.push(...fd.hunks);
  }
  allHunksCache = {
    filesByPath: state.filesByPath,
    flatFileList: state.flatFileList,
    output: out,
  };
  return out;
}

/**
 * Map from hunk ID to hunk. Cached on `filesByPath` identity.
 */
export function getHunkByIdMap(
  filesByPath: Record<string, FileDiff>,
): Map<string, DiffHunk> {
  if (hunkByIdCache && hunkByIdCache.filesByPath === filesByPath) {
    return hunkByIdCache.output;
  }
  const map = new Map<string, DiffHunk>();
  for (const fd of Object.values(filesByPath)) {
    for (const h of fd.hunks) map.set(h.id, h);
  }
  hunkByIdCache = { filesByPath, output: map };
  return map;
}

/**
 * Map from hunk ID to its location ({ filePath, indexInFile }). Cached on
 * `filesByPath` identity. Used by navigation actions to locate the focused
 * hunk in O(1) without per-call scans.
 */
export function getHunkLocationMap(
  filesByPath: Record<string, FileDiff>,
): Map<string, { filePath: string; indexInFile: number }> {
  if (hunkLocationCache && hunkLocationCache.filesByPath === filesByPath) {
    return hunkLocationCache.output;
  }
  const map = new Map<string, { filePath: string; indexInFile: number }>();
  for (const [filePath, fd] of Object.entries(filesByPath)) {
    fd.hunks.forEach((h, indexInFile) => {
      map.set(h.id, { filePath, indexInFile });
    });
  }
  hunkLocationCache = { filesByPath, output: map };
  return map;
}

export interface HunkIdsByStatus {
  /** Not approved, rejected, saved-for-later, or trusted. */
  pending: string[];
  /** Approved or rejected (explicit user action). Excludes trusted-only. */
  reviewed: string[];
  /** Marked saved-for-later. */
  savedForLater: string[];
  /** Auto-approved via a trust pattern (no explicit user action). */
  trusted: string[];
}

const EMPTY_HUNK_IDS_BY_STATUS: HunkIdsByStatus = {
  pending: [],
  reviewed: [],
  savedForLater: [],
  trusted: [],
};

let hunkIdsByStatusCache: {
  allHunks: DiffHunk[];
  reviewState: ReviewState | null;
  output: HunkIdsByStatus;
} | null = null;

/**
 * Categorize all hunks by review status. Cached on (allHunks, reviewState)
 * identity so React subscribers share a single computation.
 */
export function getHunkIdsByStatus(
  allHunks: DiffHunk[],
  reviewState: ReviewState | null,
): HunkIdsByStatus {
  if (
    hunkIdsByStatusCache &&
    hunkIdsByStatusCache.allHunks === allHunks &&
    hunkIdsByStatusCache.reviewState === reviewState
  ) {
    return hunkIdsByStatusCache.output;
  }
  if (allHunks.length === 0) {
    hunkIdsByStatusCache = {
      allHunks,
      reviewState,
      output: EMPTY_HUNK_IDS_BY_STATUS,
    };
    return EMPTY_HUNK_IDS_BY_STATUS;
  }
  const pending: string[] = [];
  const reviewed: string[] = [];
  const savedForLater: string[] = [];
  const trusted: string[] = [];
  const hunkStates = reviewState?.hunks;
  const trustList = reviewState?.trustList ?? EMPTY_TRUST_LIST;
  for (const hunk of allHunks) {
    const state = hunkStates?.[hunk.id];
    switch (effectiveHunkStatus(state, trustList)) {
      case "approved":
      case "rejected":
        reviewed.push(hunk.id);
        break;
      case "saved":
        savedForLater.push(hunk.id);
        break;
      case "trusted":
        trusted.push(hunk.id);
        break;
      default:
        pending.push(hunk.id);
    }
  }
  const output: HunkIdsByStatus = { pending, reviewed, savedForLater, trusted };
  hunkIdsByStatusCache = { allHunks, reviewState, output };
  return output;
}
