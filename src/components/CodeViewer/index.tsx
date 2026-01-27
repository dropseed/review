import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useReviewStore } from "../../stores/reviewStore";
import { Breadcrumbs } from "../Breadcrumbs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import type { FileContent } from "../../types";
import { isHunkReviewed } from "../../types";
import { OverflowMenu } from "./OverflowMenu";
import { PlainCodeView } from "./PlainCodeView";
import { UntrackedFileView } from "./UntrackedFileView";
import { DiffView } from "./DiffView";
import { ImageViewer } from "./ImageViewer";

interface CodeViewerProps {
  filePath: string;
}

export function CodeViewer({ filePath }: CodeViewerProps) {
  const {
    comparison,
    repoPath,
    codeTheme,
    codeFontSize,
    reviewState,
    approveAllFileHunks,
    revealDirectoryInTree,
  } = useReviewStore();

  // Generate CSS for font size injection into pierre/diffs
  // Pierre/diffs uses --diffs-font-size and --diffs-line-height CSS variables
  const lineHeight = Math.round(codeFontSize * 1.5);
  const fontSizeCSS = `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; }`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [viewMode, setViewMode] = useState<"unified" | "split" | "file">(
    "unified",
  );
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  // For SVG files: toggle between rendered image view and code diff view
  const [svgViewMode, setSvgViewMode] = useState<"rendered" | "code">(
    "rendered",
  );

  // Calculate review progress for this file's hunks
  // Must be before early returns to comply with React hooks rules
  const reviewProgress = useMemo(() => {
    if (!fileContent) return { reviewed: 0, total: 0 };
    const total = fileContent.hunks.length;
    if (total === 0) return { reviewed: 0, total: 0 };
    const trustList = reviewState?.trustList ?? [];
    const reviewed = fileContent.hunks.filter((hunk) =>
      isHunkReviewed(reviewState?.hunks[hunk.id], trustList),
    ).length;
    return { reviewed, total };
  }, [fileContent, reviewState]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    invoke<FileContent>("get_file_content", { repoPath, filePath, comparison })
      .then((result) => {
        setFileContent(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [repoPath, filePath, comparison]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="h-8 w-8 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
          <span className="text-stone-500">Loading file…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-6 max-w-md text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/20 mx-auto">
            <svg
              className="h-6 w-6 text-rose-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="text-rose-400 text-pretty">{error}</p>
        </div>
      </div>
    );
  }

  if (!fileContent) {
    return null;
  }

  const hasChanges = fileContent.hunks.length > 0;
  const isUntracked = hasChanges && !fileContent.diffPatch;
  const fullPath = `${repoPath}/${filePath}`;
  const contentType = fileContent.contentType || "text";
  const isImage = contentType === "image";
  const isSvg = contentType === "svg";
  const showImageViewer =
    isImage ||
    (isSvg && svgViewMode === "rendered" && fileContent.imageDataUrl);

  const handleCopyPath = async () => {
    await writeText(fullPath);
  };

  const handleReveal = async () => {
    await revealItemInDir(fullPath);
  };

  const handleOpenInEditor = async () => {
    // Try to open with default editor (VS Code, etc.)
    try {
      await openPath(fullPath);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      {/* File header with breadcrumbs */}
      <div className="flex items-center justify-between border-b border-stone-800/50 bg-stone-900 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Breadcrumbs
            filePath={filePath}
            onNavigateToDirectory={revealDirectoryInTree}
          />
          {isUntracked ? (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xxs font-medium text-emerald-400">
              New
            </span>
          ) : hasChanges ? (
            <>
              <span
                className={`rounded px-1.5 py-0.5 text-xxs font-medium tabular-nums ${
                  reviewProgress.reviewed === reviewProgress.total
                    ? "bg-lime-500/15 text-lime-400"
                    : "bg-amber-500/15 text-amber-400"
                }`}
              >
                {reviewProgress.reviewed}/{reviewProgress.total} reviewed
              </span>
              {reviewProgress.reviewed < reviewProgress.total && (
                <button
                  onClick={() => approveAllFileHunks(filePath)}
                  className="rounded bg-lime-500/10 px-1.5 py-0.5 text-xxs font-medium text-lime-400 hover:bg-lime-500/20 transition-colors"
                  title="Approve all hunks in this file"
                >
                  Approve All
                </button>
              )}
            </>
          ) : null}

          {/* File actions overflow menu */}
          <OverflowMenu>
            <button
              onClick={handleCopyPath}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy path
            </button>
            <button
              onClick={handleReveal}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              Reveal in Finder
            </button>
            <button
              onClick={handleOpenInEditor}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
              Open in editor
            </button>
          </OverflowMenu>
        </div>
        <div className="flex items-center gap-2">
          {/* SVG view mode toggle */}
          {isSvg && fileContent.imageDataUrl && (
            <div className="flex items-center rounded bg-stone-800/30 p-0.5">
              <button
                onClick={() => setSvgViewMode("rendered")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  svgViewMode === "rendered"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Rendered
              </button>
              <button
                onClick={() => setSvgViewMode("code")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  svgViewMode === "code"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Code
              </button>
            </div>
          )}
          {/* Text view mode toggle - only for text files with changes */}
          {!isImage && !showImageViewer && !isUntracked && hasChanges && (
            <div className="flex items-center rounded bg-stone-800/30 p-0.5">
              <button
                onClick={() => {
                  setViewMode("unified");
                  setHighlightLine(null);
                }}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  viewMode === "unified"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Unified
              </button>
              <button
                onClick={() => {
                  setViewMode("split");
                  setHighlightLine(null);
                }}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  viewMode === "split"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Split
              </button>
              <button
                onClick={() => {
                  setViewMode("file");
                  setHighlightLine(null);
                }}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  viewMode === "file"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                File
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto scrollbar-thin bg-stone-950">
        {showImageViewer && fileContent.imageDataUrl ? (
          <ImageViewer
            imageDataUrl={fileContent.imageDataUrl}
            oldImageDataUrl={fileContent.oldImageDataUrl}
            filePath={filePath}
            hasChanges={hasChanges}
          />
        ) : isUntracked ? (
          <UntrackedFileView
            content={fileContent.content}
            filePath={filePath}
            hunks={fileContent.hunks}
            theme={codeTheme}
            fontSizeCSS={fontSizeCSS}
          />
        ) : hasChanges && viewMode !== "file" ? (
          <DiffView
            diffPatch={fileContent.diffPatch}
            viewMode={viewMode as "unified" | "split"}
            hunks={fileContent.hunks}
            theme={codeTheme}
            fontSizeCSS={fontSizeCSS}
            onViewInFile={(line) => {
              setViewMode("file");
              setHighlightLine(line);
            }}
            fileName={filePath}
            oldContent={fileContent.oldContent}
            newContent={fileContent.content}
          />
        ) : (
          <PlainCodeView
            content={fileContent.content}
            filePath={filePath}
            highlightLine={highlightLine}
            theme={codeTheme}
            fontSizeCSS={fontSizeCSS}
          />
        )}
      </div>
    </div>
  );
}
