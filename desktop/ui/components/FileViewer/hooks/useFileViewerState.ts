import { useReviewStore } from "../../../stores";

/**
 * Bundles the store selectors used by FileViewer into a single hook. Takes
 * the currently-viewed file path so it can return a narrow `fileVersion`
 * selector — subscribing to per-path invalidation rather than a global
 * counter means unrelated file changes don't re-run the viewer's effect.
 */
export function useFileViewerState(filePath: string | null) {
  // Git / comparison context
  const comparison = useReviewStore((s) => s.comparison);
  const repoPath = useReviewStore((s) => s.repoPath);
  const fileVersion = useReviewStore((s) =>
    filePath ? (s.fileVersions[filePath] ?? 0) : 0,
  );

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
    fileVersion,
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
