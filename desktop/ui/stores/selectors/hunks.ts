import type { DiffHunk, FileDiff } from "../../types";
import { useSpurStore } from "../index";
import {
  getAllHunksFromState,
  getHunkByIdMap,
  getHunkIdsByStatus,
  type HunkIdsByStatus,
} from "./hunkData";

const EMPTY_HUNKS: DiffHunk[] = [];

/**
 * Subscribe to a single file's hunks, keyed by path. Reference identity is
 * stable until that file's hunks actually change.
 */
export function useFileHunks(filePath: string | null): DiffHunk[] {
  return useSpurStore((s) =>
    filePath ? (s.filesByPath[filePath]?.hunks ?? EMPTY_HUNKS) : EMPTY_HUNKS,
  );
}

/** Subscribe to a single file's FileDiff (hunks + contentHash). */
export function useFileDiff(filePath: string | null): FileDiff | undefined {
  return useSpurStore((s) => (filePath ? s.filesByPath[filePath] : undefined));
}

/** Hook form of {@link getAllHunksFromState}. */
export function useAllHunks(): DiffHunk[] {
  return useSpurStore(getAllHunksFromState);
}

/** Hook form of {@link getHunkByIdMap}. */
export function useHunkById(): Map<string, DiffHunk> {
  return useSpurStore((s) => getHunkByIdMap(s.filesByPath));
}

/** True if any file has at least one hunk. */
export function useHasAnyHunks(): boolean {
  return useSpurStore((s) => {
    for (const fd of Object.values(s.filesByPath)) {
      if (fd.hunks.length > 0) return true;
    }
    return false;
  });
}

/** Hook form of {@link getHunkIdsByStatus}. */
export function useHunkIdsByStatus(): HunkIdsByStatus {
  const allHunks = useAllHunks();
  const reviewState = useSpurStore((s) => s.reviewState);
  return getHunkIdsByStatus(allHunks, reviewState ?? null);
}
