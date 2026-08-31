import { useSpurStore } from "../../../stores";
import { useFileHunks } from "../../../stores/selectors/hunks";

/**
 * Bundles store selectors used by FileViewer into one hook. The viewer
 * invalidates when its file's hunks change (via `fileHunks`) or, in non-
 * review modes, when the file watcher bumps `fileVersions[path]`.
 */
export function useFileViewerState(filePath: string | null) {
  // Git / comparison context
  const comparison = useSpurStore((s) => s.comparison);
  const repoPath = useSpurStore((s) => s.repoPath);
  const workingTreePath = useSpurStore((s) => s.worktreePath ?? s.repoPath);
  const fileVersion = useSpurStore((s) =>
    filePath ? (s.fileVersions[filePath] ?? 0) : 0,
  );

  // Preferences
  const codeTheme = useSpurStore((s) => s.codeTheme);
  const codeFontSize = useSpurStore((s) => s.codeFontSize);
  const codeFontFamily = useSpurStore((s) => s.codeFontFamily);

  // Review state
  const reviewState = useSpurStore((s) => s.reviewState);
  const fileHunks = useFileHunks(filePath);

  // Working tree diff (Git panel)
  const workingTreeDiffFile = useSpurStore((s) => s.workingTreeDiffFile);
  const gitStatus = useSpurStore((s) => s.gitStatus);

  // Annotations
  const addAnnotation = useSpurStore((s) => s.addAnnotation);
  const updateAnnotation = useSpurStore((s) => s.updateAnnotation);
  const deleteAnnotation = useSpurStore((s) => s.deleteAnnotation);
  const resolveAnnotation = useSpurStore((s) => s.resolveAnnotation);
  const unresolveAnnotation = useSpurStore((s) => s.unresolveAnnotation);

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
