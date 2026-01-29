import { useState, useEffect, useMemo, forwardRef } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import { useReviewStore } from "../../stores/reviewStore";
import { getApiClient } from "../../api";
import type { FileContent, DiffHunk } from "../../types";
import { isHunkReviewed } from "../../types";
import { DiffView } from "../CodeViewer/DiffView";
import { UntrackedFileView } from "../CodeViewer/UntrackedFileView";

interface RollingFileSectionProps {
  filePath: string;
  isVisible: boolean;
}

export const RollingFileSection = forwardRef<
  HTMLDivElement,
  RollingFileSectionProps
>(function RollingFileSection({ filePath, isVisible }, ref) {
  const {
    comparison,
    repoPath,
    codeTheme,
    codeFontSize,
    reviewState,
    approveAllFileHunks,
    setSelectedFile,
    hunks: allHunks,
    focusedHunkIndex,
  } = useReviewStore();

  // Get the focused hunk ID if it's in this file
  const focusedHunk = allHunks[focusedHunkIndex];
  const focusedHunkId =
    focusedHunk?.filePath === filePath ? focusedHunk.id : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Generate CSS for font size
  const lineHeight = Math.round(codeFontSize * 1.5);
  const fontSizeCSS = `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; }`;

  // Calculate review progress
  const reviewProgress = useMemo(() => {
    if (!fileContent) return { reviewed: 0, total: 0 };
    const total = fileContent.hunks.length;
    if (total === 0) return { reviewed: 0, total: 0 };
    const trustList = reviewState?.trustList ?? [];
    const reviewed = fileContent.hunks.filter((hunk: DiffHunk) =>
      isHunkReviewed(reviewState?.hunks[hunk.id], trustList),
    ).length;
    return { reviewed, total };
  }, [fileContent, reviewState]);

  // Load file content when section becomes visible (lazy loading)
  useEffect(() => {
    if (!isVisible || hasLoaded || !repoPath || !comparison) return;

    setLoading(true);
    setError(null);

    getApiClient()
      .getFileContent(repoPath, filePath, comparison)
      .then((result) => {
        setFileContent(result);
        setLoading(false);
        setHasLoaded(true);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
        setHasLoaded(true);
      });
  }, [isVisible, hasLoaded, repoPath, filePath, comparison]);

  const fileName = filePath.split("/").pop() || filePath;
  const dirPath = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/"))
    : "";
  const hasChanges = fileContent ? fileContent.hunks.length > 0 : false;
  const isUntracked = hasChanges && fileContent && !fileContent.diffPatch;
  const isFullyReviewed =
    reviewProgress.total > 0 &&
    reviewProgress.reviewed === reviewProgress.total;

  return (
    <div
      ref={ref}
      data-filepath={filePath}
      className="border-b border-stone-800"
    >
      {/* Sticky file header */}
      <div
        className={`sticky top-0 z-10 flex items-center justify-between border-b border-stone-700/50 px-4 py-2 backdrop-blur-sm ${
          isFullyReviewed
            ? "bg-lime-500/5 border-lime-500/20"
            : "bg-stone-900/95"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Collapse/expand toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex h-5 w-5 items-center justify-center rounded text-stone-500 hover:bg-stone-800 hover:text-stone-300 transition-colors"
            aria-label={isCollapsed ? "Expand file" : "Collapse file"}
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>

          {/* File path */}
          <SimpleTooltip content={`Open ${filePath} in single file view`}>
            <button
              onClick={() => setSelectedFile(filePath)}
              className="flex items-center gap-1.5 min-w-0 text-left hover:text-amber-400 transition-colors"
            >
              {dirPath && (
                <span className="text-xs text-stone-500 truncate">
                  {dirPath}/
                </span>
              )}
              <span className="text-sm font-medium text-stone-200 truncate">
                {fileName}
              </span>
            </button>
          </SimpleTooltip>

          {/* Status badges */}
          {isUntracked && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xxs font-medium text-emerald-400">
              New
            </span>
          )}
          {reviewProgress.total > 0 && (
            <span
              className={`rounded px-1.5 py-0.5 text-xxs font-medium tabular-nums ${
                isFullyReviewed
                  ? "bg-lime-500/15 text-lime-400"
                  : "bg-amber-500/15 text-amber-400"
              }`}
            >
              {reviewProgress.reviewed}/{reviewProgress.total}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {reviewProgress.reviewed < reviewProgress.total && (
            <SimpleTooltip content="Approve all hunks in this file">
              <button
                onClick={() => approveAllFileHunks(filePath)}
                className="rounded bg-lime-500/10 px-2 py-1 text-xs font-medium text-lime-400 hover:bg-lime-500/20 transition-colors"
              >
                Approve All
              </button>
            </SimpleTooltip>
          )}
        </div>
      </div>

      {/* Content area */}
      {!isCollapsed && (
        <div className="bg-stone-950">
          {loading && !hasLoaded ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="h-6 w-6 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
                <span className="text-xs text-stone-500">Loading...</span>
              </div>
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-4 text-center">
                <p className="text-sm text-rose-400">{error}</p>
              </div>
            </div>
          ) : fileContent && hasChanges ? (
            isUntracked ? (
              <UntrackedFileView
                content={fileContent.content}
                filePath={filePath}
                hunks={fileContent.hunks}
                theme={codeTheme}
                fontSizeCSS={fontSizeCSS}
              />
            ) : (
              <DiffView
                diffPatch={fileContent.diffPatch}
                viewMode="unified"
                hunks={fileContent.hunks}
                theme={codeTheme}
                fontSizeCSS={fontSizeCSS}
                fileName={filePath}
                oldContent={fileContent.oldContent}
                newContent={fileContent.content}
                focusedHunkId={focusedHunkId}
              />
            )
          ) : (
            <div className="py-8 text-center text-xs text-stone-500">
              No changes in this file
            </div>
          )}
        </div>
      )}
    </div>
  );
});
