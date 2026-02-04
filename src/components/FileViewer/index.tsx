import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useReviewStore } from "../../stores";
import { Breadcrumbs } from "../Breadcrumbs";
import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";
import type { FileContent } from "../../types";
import { isHunkReviewed } from "../../types";
import type {
  DiffLineDiffType,
  DiffIndicators,
} from "../../stores/slices/preferencesSlice";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { SimpleTooltip } from "../ui/tooltip";
import { FileContentRenderer } from "./FileContentRenderer";
import { DiffMinimap, getHunkStatus, type MinimapMarker } from "./DiffMinimap";
import { useScrollHunkTracking } from "../../hooks";
import { InFileSearchBar } from "./InFileSearchBar";
import {
  isMarkdownFile,
  detectLanguage,
  type SupportedLanguages,
} from "./languageMap";
import { LanguageSelector } from "./LanguageSelector";

interface FileViewerProps {
  filePath: string;
}

export function FileViewer({ filePath }: FileViewerProps) {
  const comparison = useReviewStore((s) => s.comparison);
  const repoPath = useReviewStore((s) => s.repoPath);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const reviewState = useReviewStore((s) => s.reviewState);
  const approveAllFileHunks = useReviewStore((s) => s.approveAllFileHunks);
  const rejectAllFileHunks = useReviewStore((s) => s.rejectAllFileHunks);
  const revealDirectoryInTree = useReviewStore((s) => s.revealDirectoryInTree);
  const allHunks = useReviewStore((s) => s.hunks);
  const focusedHunkIndex = useReviewStore((s) => s.focusedHunkIndex);
  const scrollToLine = useReviewStore((s) => s.scrollToLine);
  const clearScrollToLine = useReviewStore((s) => s.clearScrollToLine);
  const addAnnotation = useReviewStore((s) => s.addAnnotation);
  const updateAnnotation = useReviewStore((s) => s.updateAnnotation);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);
  const diffLineDiffType = useReviewStore((s) => s.diffLineDiffType);
  const diffIndicators = useReviewStore((s) => s.diffIndicators);
  const setDiffLineDiffType = useReviewStore((s) => s.setDiffLineDiffType);
  const setDiffIndicators = useReviewStore((s) => s.setDiffIndicators);
  const viewMode = useReviewStore((s) => s.diffViewMode);
  const setViewMode = useReviewStore((s) => s.setDiffViewMode);
  const classifyingHunkIds = useReviewStore((s) => s.classifyingHunkIds);

  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);

  // Get the focused hunk ID if it's in this file
  const focusedHunk = allHunks[focusedHunkIndex];
  const focusedHunkId =
    focusedHunk?.filePath === filePath ? focusedHunk.id : null;

  // Generate CSS for font size injection into pierre/diffs
  // Pierre/diffs uses --diffs-font-size and --diffs-line-height CSS variables
  const lineHeight = Math.round(codeFontSize * 1.5);
  const fontSizeCSS = `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; }`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  // Tracks which filePath the current fileContent belongs to, preventing
  // one-frame stale renders where filePath has changed but content hasn't yet.
  const [fileContentPath, setFileContentPath] = useState<string | null>(null);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  // For SVG files: toggle between rendered image view and code diff view
  const [svgViewMode, setSvgViewMode] = useState<"rendered" | "code">(
    "rendered",
  );
  // For markdown files: toggle between preview and code/diff view
  const [markdownViewMode, setMarkdownViewMode] = useState<"preview" | "code">(
    "code",
  );
  // Language override for syntax highlighting
  const [languageOverride, setLanguageOverride] = useState<
    SupportedLanguages | undefined
  >(undefined);

  // Diff options popover state
  const [showDiffOptions, setShowDiffOptions] = useState(false);
  const diffOptionsRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showDiffOptions) return;
    const handleClick = (e: MouseEvent) => {
      if (
        diffOptionsRef.current &&
        !diffOptionsRef.current.contains(e.target as Node)
      ) {
        setShowDiffOptions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDiffOptions]);

  // In-file search state
  const [inFileSearchOpen, setInFileSearchOpen] = useState(false);

  // Handle search highlight — stable callback for InFileSearchBar
  const handleSearchHighlightLine = useCallback((line: number | null) => {
    setHighlightLine(line);
  }, []);

  // Close search and clear highlight
  const handleCloseSearch = useCallback(() => {
    setInFileSearchOpen(false);
    setHighlightLine(null);
  }, []);

  // Reset search when file changes
  useEffect(() => {
    setInFileSearchOpen(false);
  }, [filePath]);

  // Cmd+F listener to open in-file search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        if (fileContent) {
          setInFileSearchOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fileContent]);

  // Calculate review progress for this file's hunks
  // Must be before early returns to comply with React hooks rules
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const reviewProgress = useMemo(() => {
    if (!fileContent) return { reviewed: 0, total: 0 };
    const total = fileContent.hunks.length;
    if (total === 0) return { reviewed: 0, total: 0 };
    const trustList = reviewState?.trustList ?? [];
    const reviewed = fileContent.hunks.filter((hunk) =>
      isHunkReviewed(reviewState?.hunks[hunk.id], trustList, {
        autoApproveStaged: reviewState?.autoApproveStaged,
        stagedFilePaths,
        filePath,
      }),
    ).length;
    return { reviewed, total };
  }, [fileContent, reviewState, stagedFilePaths, filePath]);

  // Reset language override when switching files
  useEffect(() => {
    setLanguageOverride(undefined);
  }, [filePath]);

  // Handle scrollToLine from search - switch to file view and highlight the line
  // Wait until file content is loaded before applying the scroll
  useEffect(() => {
    if (
      scrollToLine &&
      scrollToLine.filePath === filePath &&
      !loading &&
      fileContent
    ) {
      setHighlightLine(scrollToLine.lineNumber);
      clearScrollToLine();

      // Clear highlight after 2 seconds
      const timeout = setTimeout(() => {
        setHighlightLine(null);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [scrollToLine, filePath, loading, fileContent, clearScrollToLine]);

  // Derive a stable key from hunk IDs for this file.
  // Hunk IDs include content hashes (filepath:hash), so any actual content
  // change produces new IDs, triggering a re-fetch without a global counter.
  const fileHunkKey = useMemo(
    () =>
      allHunks
        .filter((h) => h.filePath === filePath)
        .map((h) => h.id)
        .join(","),
    [allHunks, filePath],
  );

  const prevFilePathRef = useRef(filePath);

  useEffect(() => {
    if (!repoPath || !comparison) return;

    let cancelled = false;

    const isFileSwitch = prevFilePathRef.current !== filePath;
    prevFilePathRef.current = filePath;

    // Only show spinner on file switch or initial load
    if (isFileSwitch || !fileContent) {
      setLoading(true);
    }
    if (isFileSwitch) {
      setFileContentPath(null);
    }
    setError(null);

    getApiClient()
      .getFileContent(repoPath, filePath, comparison)
      .then((result) => {
        if (!cancelled) {
          setFileContent(result);
          setFileContentPath(filePath);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, filePath, comparison, fileHunkKey]);

  // Minimap hooks — must be before early returns
  const fileHunkIndices = useMemo(
    () =>
      allHunks.reduce<number[]>((acc, h, i) => {
        if (h.filePath === filePath) acc.push(i);
        return acc;
      }, []),
    [allHunks, filePath],
  );

  const handleMinimapHunkClick = useCallback(
    (localIndex: number) => {
      const globalIndex = fileHunkIndices[localIndex];
      if (globalIndex !== undefined) {
        useReviewStore.setState({ focusedHunkIndex: globalIndex });
      }
    },
    [fileHunkIndices],
  );

  const totalLineCount = useMemo(() => {
    const s = fileContent?.content;
    if (!s) return 0;
    let count = 1;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [fileContent?.content]);

  const trustList = reviewState?.trustList ?? [];

  const minimapMarkers = useMemo<MinimapMarker[]>(() => {
    if (!fileContent || totalLineCount === 0) return [];
    return fileContent.hunks.map((hunk) => ({
      id: hunk.id,
      topFraction: (hunk.newStart - 1) / totalLineCount,
      heightFraction: hunk.newCount / totalLineCount,
      status: getHunkStatus(
        hunk.id,
        reviewState,
        trustList,
        classifyingHunkIds,
      ),
      isFocused: hunk.id === focusedHunkId,
    }));
  }, [
    fileContent,
    totalLineCount,
    reviewState,
    trustList,
    classifyingHunkIds,
    focusedHunkId,
  ]);

  // Track scroll position to update HunkNavigator counter
  useScrollHunkTracking(scrollNode, fileHunkIndices, allHunks);

  if (loading || fileContentPath !== filePath) {
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
  const detectedLanguage = detectLanguage(filePath, fileContent.content);
  const effectiveLanguage = languageOverride ?? detectedLanguage;
  const showImageViewer =
    isImage ||
    (isSvg && svgViewMode === "rendered" && fileContent.imageDataUrl);

  const handleCopyPath = async () => {
    const platform = getPlatformServices();
    await platform.clipboard.writeText(fullPath);
  };

  const handleReveal = async () => {
    const platform = getPlatformServices();
    await platform.opener.revealItemInDir(fullPath);
  };

  const handleOpenInEditor = async () => {
    // Try to open with default editor (VS Code, etc.)
    try {
      const platform = getPlatformServices();
      await platform.opener.openPath(fullPath);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  /** Renders the file status badge based on whether file is new, has changes, or unchanged */
  function renderFileStatusBadge() {
    if (isUntracked) {
      return (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xxs font-medium text-emerald-400">
          New
        </span>
      );
    }

    if (!hasChanges) {
      return null;
    }

    const isComplete = reviewProgress.reviewed === reviewProgress.total;
    const badgeClass = isComplete
      ? "bg-emerald-500/15 text-emerald-300"
      : "bg-amber-500/15 text-amber-300";

    return (
      <>
        <span
          className={`rounded px-1.5 py-0.5 text-xxs font-medium tabular-nums ${badgeClass}`}
        >
          {reviewProgress.reviewed}/{reviewProgress.total} reviewed
        </span>
        {!isComplete && (
          <SimpleTooltip content="Approve all hunks in this file">
            <button
              onClick={() => approveAllFileHunks(filePath)}
              className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xxs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              Approve
            </button>
          </SimpleTooltip>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      {/* File header with breadcrumbs */}
      <div className="flex items-center justify-between border-b border-stone-800/50 bg-stone-900 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Breadcrumbs
            filePath={filePath}
            onNavigateToDirectory={revealDirectoryInTree}
          />
          {/* Language selector only works in file view mode (not diff views) */}
          {!isImage && !hasChanges && (
            <LanguageSelector
              language={effectiveLanguage}
              detectedLanguage={detectedLanguage}
              isOverridden={languageOverride !== undefined}
              onLanguageChange={setLanguageOverride}
            />
          )}
          {renderFileStatusBadge()}

          {/* File actions overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-1 text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50"
                aria-label="More options"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
                  />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyPath}>
                <svg
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
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleReveal}>
                <svg
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
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenInEditor}>
                <svg
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
              </DropdownMenuItem>
              {hasChanges && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => rejectAllFileHunks(filePath)}
                  >
                    <svg
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                      />
                    </svg>
                    Reject all hunks
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          {/* Markdown view mode toggle */}
          {isMarkdownFile(filePath) && (
            <div className="flex items-center rounded bg-stone-800/30 p-0.5">
              <button
                onClick={() => setMarkdownViewMode("preview")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  markdownViewMode === "preview"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => setMarkdownViewMode("code")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  markdownViewMode === "code"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Code
              </button>
            </div>
          )}
          {/* SVG view mode toggle */}
          {isSvg && fileContent.imageDataUrl && (
            <div className="flex items-center rounded bg-stone-800/30 p-0.5">
              <button
                onClick={() => setSvgViewMode("rendered")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  svgViewMode === "rendered"
                    ? "bg-stone-700/50 text-stone-200"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                Rendered
              </button>
              <button
                onClick={() => setSvgViewMode("code")}
                className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
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
            <>
              <div className="flex items-center rounded bg-stone-800/30 p-0.5">
                <button
                  onClick={() => {
                    setViewMode("unified");
                    setHighlightLine(null);
                  }}
                  className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
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
                  className={`rounded px-2 py-0.5 text-xxs font-medium transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                    viewMode === "split"
                      ? "bg-stone-700/50 text-stone-200"
                      : "text-stone-500 hover:text-stone-300"
                  }`}
                >
                  Split
                </button>
              </div>
              {/* Diff display options */}
              <div className="relative" ref={diffOptionsRef}>
                <SimpleTooltip content="Diff display options">
                  <button
                    onClick={() => setShowDiffOptions(!showDiffOptions)}
                    className={`rounded p-1 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300 ${
                      showDiffOptions ? "bg-stone-800 text-stone-300" : ""
                    }`}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                    </svg>
                  </button>
                </SimpleTooltip>
                {showDiffOptions && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-stone-700 bg-stone-900 shadow-xl">
                    <div className="px-3 py-2 border-b border-stone-800">
                      <span className="text-xxs font-medium text-stone-500 uppercase tracking-wide">
                        Highlighting
                      </span>
                    </div>
                    <div className="p-1">
                      {(
                        [
                          ["word", "Word"],
                          ["word-alt", "Word Alt"],
                          ["char", "Char"],
                          ["none", "None"],
                        ] as [DiffLineDiffType, string][]
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setDiffLineDiffType(value)}
                          className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
                            diffLineDiffType === value
                              ? "bg-stone-800 text-stone-200"
                              : "text-stone-400 hover:bg-stone-800/50 hover:text-stone-300"
                          }`}
                        >
                          <span>{label}</span>
                          {diffLineDiffType === value && (
                            <svg
                              className="h-3 w-3 text-amber-500"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="px-3 py-2 border-t border-b border-stone-800">
                      <span className="text-xxs font-medium text-stone-500 uppercase tracking-wide">
                        Indicators
                      </span>
                    </div>
                    <div className="p-1">
                      {(
                        [
                          ["classic", "Classic (+/-)"],
                          ["bars", "Bars"],
                          ["none", "None"],
                        ] as [DiffIndicators, string][]
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setDiffIndicators(value)}
                          className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
                            diffIndicators === value
                              ? "bg-stone-800 text-stone-200"
                              : "text-stone-400 hover:bg-stone-800/50 hover:text-stone-300"
                          }`}
                        >
                          <span>{label}</span>
                          {diffIndicators === value && (
                            <svg
                              className="h-3 w-3 text-amber-500"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="relative flex flex-1 overflow-hidden">
        <div
          ref={setScrollNode}
          className={`min-w-0 flex-1 h-full overflow-auto bg-stone-950 ${hasChanges && !showImageViewer ? "scrollbar-none" : "scrollbar-thin"}`}
        >
          {/* In-file search bar */}
          {inFileSearchOpen && fileContent && (
            <div className="sticky top-0 z-10 flex justify-end p-2">
              <InFileSearchBar
                content={fileContent.content}
                onHighlightLine={handleSearchHighlightLine}
                onClose={handleCloseSearch}
              />
            </div>
          )}
          <FileContentRenderer
            filePath={filePath}
            fileContent={fileContent}
            viewMode={viewMode}
            codeTheme={codeTheme}
            fontSizeCSS={fontSizeCSS}
            focusedHunkId={focusedHunkId}
            effectiveLanguage={effectiveLanguage}
            markdownViewMode={markdownViewMode}
            svgViewMode={svgViewMode}
            showImageViewer={!!showImageViewer}
            isUntracked={isUntracked}
            hasChanges={hasChanges}
            highlightLine={highlightLine}
            lineHeight={lineHeight}
            onViewInFile={(line) => {
              setHighlightLine(line);
            }}
            reviewState={reviewState}
            addAnnotation={addAnnotation}
            updateAnnotation={updateAnnotation}
            deleteAnnotation={deleteAnnotation}
          />
        </div>
        {hasChanges && !showImageViewer && (
          <DiffMinimap
            markers={minimapMarkers}
            scrollContainer={scrollNode}
            onMarkerClick={handleMinimapHunkClick}
          />
        )}
      </div>
    </div>
  );
}
