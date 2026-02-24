import { useCallback } from "react";
import { useReviewStore } from "../../../stores";
import {
  type DiffViewMode,
  resolveViewModeForFile,
} from "../../../stores/slices/preferencesSlice";

/** Returns the effective diff view mode for a file and a setter that persists per-extension. */
export function useDiffViewMode(
  filePath: string,
): [DiffViewMode, (mode: DiffViewMode) => void] {
  const viewMode = useReviewStore((s) =>
    resolveViewModeForFile(filePath, s.diffViewMode, s.diffViewModeByExtension),
  );
  const setForFile = useReviewStore((s) => s.setDiffViewModeForFile);
  const setViewMode = useCallback(
    (mode: DiffViewMode) => setForFile(filePath, mode),
    [filePath, setForFile],
  );
  return [viewMode, setViewMode];
}
