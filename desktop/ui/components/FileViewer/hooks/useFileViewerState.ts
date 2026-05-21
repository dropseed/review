import { useReviewStore } from "../../../stores";
import { useFileHunks } from "../../../stores/selectors/hunks";

/**
 * Bundles store selectors used by FileViewer into one hook. The viewer
 * invalidates when its file's hunks change (via `fileHunks`) or, in non-
 * review modes, when the file watcher bumps `fileVersions[path]`.
 */
export function useFileViewerState(filePath: string | null) {
  // Git / comparison context
  const comparison = useReviewStore((s) => s.comparison);
  const repoPath = useReviewStore((s) => s.repoPath);
  const workingTreePath = useReviewStore((s) => s.worktreePath ?? s.repoPath);
  const fileVersion = useReviewStore((s) =>
    filePath ? (s.fileVersions[filePath] ?? 0) : 0,
  );

  // Preferences
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const codeFontFamily = useReviewStore((s) => s.codeFontFamily);

  // Review state
  const reviewState = useReviewStore((s) => s.reviewState);
  const fileHunks = useFileHunks(filePath);

  // Working tree diff (Git panel)
  const workingTreeDiffFile = useReviewStore((s) => s.workingTreeDiffFile);
  const gitStatus = useReviewStore((s) => s.gitStatus);

  // Annotations
  const addAnnotation = useReviewStore((s) => s.addAnnotation);
  const updateAnnotation = useReviewStore((s) => s.updateAnnotation);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);
  const resolveAnnotation = useReviewStore((s) => s.resolveAnnotation);
  const unresolveAnnotation = useReviewStore((s) => s.unresolveAnnotation);

  return {
    comparison,
    repoPath,
    workingTreePath,
    codeTheme,
    codeFontSize,
    codeFontFamily,
    reviewState,
    fileHunks,
    fileVersion,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    resolveAnnotation,
    unresolveAnnotation,
    workingTreeDiffFile,
    gitStatus,
  };
}
