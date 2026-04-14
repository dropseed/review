import type { DiffHunk, FileDiff } from "../../types";
import { useReviewStore } from "../index";

const EMPTY_HUNKS: DiffHunk[] = [];

/**
 * Subscribe to a single file's hunks, keyed by path. Reference identity is
 * stable until that file's hunks actually change.
 */
export function useFileHunks(filePath: string | null): DiffHunk[] {
  return useReviewStore((s) =>
    filePath ? (s.filesByPath[filePath]?.hunks ?? EMPTY_HUNKS) : EMPTY_HUNKS,
  );
}

/** Subscribe to a single file's FileDiff (hunks + contentHash). */
export function useFileDiff(filePath: string | null): FileDiff | undefined {
  return useReviewStore((s) =>
    filePath ? s.filesByPath[filePath] : undefined,
  );
}

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

/** Hook form of {@link getAllHunksFromState}. */
export function useAllHunks(): DiffHunk[] {
  return useReviewStore(getAllHunksFromState);
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

/** Hook form of {@link getHunkByIdMap}. */
export function useHunkById(): Map<string, DiffHunk> {
  return useReviewStore((s) => getHunkByIdMap(s.filesByPath));
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

/** True if any file has at least one hunk. */
export function useHasAnyHunks(): boolean {
  return useReviewStore((s) => {
    for (const fd of Object.values(s.filesByPath)) {
      if (fd.hunks.length > 0) return true;
    }
    return false;
  });
}
