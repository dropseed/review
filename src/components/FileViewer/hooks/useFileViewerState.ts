import { useReviewStore } from "../../../stores";

/** Bundles the 16 individual store selectors used by FileViewer into grouped objects. */
export function useFileViewerState() {
  // Git / comparison context
  const comparison = useReviewStore((s) => s.comparison);
  const repoPath = useReviewStore((s) => s.repoPath);
  const refreshGeneration = useReviewStore((s) => s.refreshGeneration);

  // Preferences
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const viewMode = useReviewStore((s) => s.diffViewMode);

  // Review state
  const reviewState = useReviewStore((s) => s.reviewState);
  const allHunks = useReviewStore((s) => s.hunks);
  const classifyingHunkIds = useReviewStore((s) => s.classifyingHunkIds);

  // Navigation
  const focusedHunkIndex = useReviewStore((s) => s.focusedHunkIndex);
  const scrollToLine = useReviewStore((s) => s.scrollToLine);
  const clearScrollToLine = useReviewStore((s) => s.clearScrollToLine);

  // Annotations
  const addAnnotation = useReviewStore((s) => s.addAnnotation);
  const updateAnnotation = useReviewStore((s) => s.updateAnnotation);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);

  return {
    comparison,
    repoPath,
    refreshGeneration,
    codeTheme,
    codeFontSize,
    viewMode,
    reviewState,
    allHunks,
    classifyingHunkIds,
    focusedHunkIndex,
    scrollToLine,
    clearScrollToLine,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
  };
}
