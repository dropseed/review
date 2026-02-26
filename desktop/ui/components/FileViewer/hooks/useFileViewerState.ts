import { useReviewStore } from "../../../stores";

/** Bundles the store selectors used by FileViewer into a single hook. */
export function useFileViewerState() {
  // Git / comparison context
  const comparison = useReviewStore((s) => s.comparison);
  const repoPath = useReviewStore((s) => s.repoPath);
  const refreshGeneration = useReviewStore((s) => s.refreshGeneration);

  // Preferences
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const codeFontFamily = useReviewStore((s) => s.codeFontFamily);

  // Review state
  const reviewState = useReviewStore((s) => s.reviewState);
  const allHunks = useReviewStore((s) => s.hunks);

  // Working tree diff (Git panel)
  const workingTreeDiffFile = useReviewStore((s) => s.workingTreeDiffFile);
  const gitStatus = useReviewStore((s) => s.gitStatus);

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
    codeFontFamily,
    reviewState,
    allHunks,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    workingTreeDiffFile,
    gitStatus,
  };
}
