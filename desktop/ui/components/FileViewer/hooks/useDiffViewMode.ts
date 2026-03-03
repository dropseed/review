import { useCallback, useEffect, useState } from "react";
import { useReviewStore } from "../../../stores";
import {
  type DiffViewMode,
  resolveViewModeForFile,
} from "../../../stores/slices/preferencesSlice";

/**
 * Returns the effective diff view mode for a file and a setter.
 * old/new modes are always ephemeral (never persisted).
 * When isSplitActive, all modes are pane-local for independent split-view toggles.
 */
export function useDiffViewMode(
  filePath: string,
  isSplitActive?: boolean,
): [DiffViewMode, (mode: DiffViewMode) => void] {
  const storeViewMode = useReviewStore((s) =>
    resolveViewModeForFile(filePath, s.diffViewMode, s.diffViewModeByExtension),
  );
  const setForFile = useReviewStore((s) => s.setDiffViewModeForFile);

  // Per-pane override — old/new is always ephemeral (never persisted);
  // in split view, all toggles are independent between panes.
  const [override, setOverride] = useState<DiffViewMode | null>(null);

  useEffect(() => {
    setOverride(null);
  }, [filePath]);

  useEffect(() => {
    if (!isSplitActive) {
      setOverride(null);
    }
  }, [isSplitActive]);

  const viewMode = override !== null ? override : storeViewMode;

  const setViewMode = useCallback(
    (mode: DiffViewMode) => {
      if (mode === "old" || mode === "new" || isSplitActive) {
        // old/new never persists; in split view, all modes are pane-local
        setOverride(mode);
      } else {
        // Single pane, unified/split — persist to preferences
        setOverride(null);
        setForFile(filePath, mode);
      }
    },
    [filePath, setForFile, isSplitActive],
  );

  return [viewMode, setViewMode];
}
