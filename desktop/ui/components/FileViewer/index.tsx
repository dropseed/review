import {
  type ReactNode,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { Virtualizer as VirtualizerClass } from "@pierre/diffs";
import { VirtualizerContext } from "@pierre/diffs/react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { useFileViewerState } from "./hooks/useFileViewerState";
import type { FileContent, FileEntry } from "../../types";
import { Spinner } from "../ui/spinner";
import { isHunkReviewed, makeComparison } from "../../types";
import { FileContentRenderer } from "./FileContentRenderer";
import {
  DiffMinimap,
  getMarkerStatus,
  type MinimapMarker,
} from "./DiffMinimap";
import {
  useScrollHunkTracking,
  useScrollAnchor,
  useSymbolNavigation,
  useWordHighlight,
  useHoverInfo,
} from "../../hooks";
import { InFileSearchBar } from "./InFileSearchBar";
import {
  detectLanguage,
  isMarkdownFile,
  type SupportedLanguages,
} from "./languageMap";
import { getUrlAtClick } from "../../utils/getUrlAtClick";
import { getPlatformServices } from "../../platform";
import { FileViewerToolbar } from "./FileViewerToolbar";
import {
  AnnotationEditor,
  AnnotationDisplay,
} from "./annotations/AnnotationEditor";
import { SymbolPopover } from "./SymbolPopover";
import { HoverTooltip } from "./HoverTooltip";
import { SymbolOutlinePanel } from "./SymbolOutlinePanel";
import { useFileSymbols } from "./useFileSymbols";
import type { ContentMode } from "./content-mode";
import { useDiffViewMode } from "./hooks/useDiffViewMode";

const PLAIN_MODE: ContentMode = { type: "plain" };
const IMAGE_MODE: ContentMode = { type: "image" };

/** Recursively search the file tree for an entry with the given path and status. */
function hasFileStatus(
  entries: FileEntry[],
  path: string,
  status: FileEntry["status"],
): boolean {
  for (const entry of entries) {
    if (entry.path === path) return entry.status === status;
    if (entry.children && hasFileStatus(entry.children, path, status))
      return true;
  }
  return false;
}

const CMD_HOVER_STYLE_ID = "cmd-hover-style";
const CMD_HOVER_CSS = `code span { cursor: pointer; }`;

interface FileViewerProps {
  filePath: string;
  isFocusedPane?: boolean;
  pane?: "primary" | "secondary";
}

export function FileViewer({
  filePath,
  isFocusedPane,
  pane,
}: FileViewerProps): ReactNode {
  const {
    comparison,
    repoPath,
    codeTheme,
    codeFontSize,
    codeFontFamily,
    reviewState,
    allHunks,
    refreshGeneration,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    workingTreeDiffFile,
    gitStatus,
  } = useFileViewerState();

  const externalFilePath = useReviewStore((s) => s.externalFilePath);
  const isExternalFile = externalFilePath !== null;

  const isWorkingTreeMode = workingTreeDiffFile === filePath;
  const workingTreeDiffMode = useReviewStore((s) => s.workingTreeDiffMode);
  const isSplitActive = useReviewStore((s) => s.secondaryFile) !== null;
  const splitOrientation = useReviewStore((s) => s.splitOrientation);
  const showOutline = useReviewStore((s) => s.showOutline);
  const fileSymbols = useFileSymbols(filePath);
  const hasSymbols = fileSymbols !== null && fileSymbols.length > 0;

  const [viewMode, setViewMode] = useDiffViewMode(filePath, isSplitActive);

  const [virtualizer] = useState(() => new VirtualizerClass());
  useEffect(() => {
    return () => virtualizer.cleanUp();
  }, [virtualizer]);
  const [scrollNode, setScrollNodeState] = useState<HTMLDivElement | null>(
    null,
  );
  const setScrollNode = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) virtualizer.setup(node);
      else virtualizer.cleanUp();
      setScrollNodeState(node);
    },
    [virtualizer],
  );

  // Symbol navigation (Cmd+Click)
  const {
    popoverOpen,
    popoverPosition,
    symbolName,
    definitions,
    references,
    loading: symbolLoading,
    handleSymbolClick,
    closePopover,
    navigateToDefinition,
    navigateToReference,
  } = useSymbolNavigation();

  useWordHighlight(scrollNode);

  // LSP hover tooltips (Cmd+hover)
  const {
    hoverContent,
    hoverPosition: hoverPos,
    dismissHover,
  } = useHoverInfo(scrollNode);

  // Cmd+hover CSS injection and Cmd+Click handling — entirely imperative to
  // avoid re-rendering FileViewer on every Cmd press/release (rerender-use-ref-transient-values).
  const handleSymbolClickRef = useRef(handleSymbolClick);
  handleSymbolClickRef.current = handleSymbolClick;
  const closePopoverRef = useRef(closePopover);
  closePopoverRef.current = closePopover;
  const dismissHoverRef = useRef(dismissHover);
  dismissHoverRef.current = dismissHover;

  useEffect(() => {
    const node = scrollNode;
    if (!node) return;

    const getShadowRoot = () =>
      node.querySelector("diffs-container")?.shadowRoot ?? null;

    const injectStyle = () => {
      const shadow = getShadowRoot();
      if (!shadow || shadow.getElementById(CMD_HOVER_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = CMD_HOVER_STYLE_ID;
      style.textContent = CMD_HOVER_CSS;
      shadow.appendChild(style);
    };

    const removeStyle = () => {
      getShadowRoot()?.getElementById(CMD_HOVER_STYLE_ID)?.remove();
    };

    // Track Cmd state imperatively — no React state, no re-renders
    let cmdDown = false;
    let hoveredSpan: HTMLElement | null = null;

    const clearHoverStyle = () => {
      if (hoveredSpan) {
        hoveredSpan.style.textDecoration = "";
        hoveredSpan = null;
      }
    };

    const handleMouseOver = (e: Event) => {
      if (!cmdDown) return;
      const target = (e as MouseEvent).composedPath?.()[0];
      if (
        target instanceof HTMLElement &&
        target.tagName === "SPAN" &&
        target.textContent?.trim()
      ) {
        if (target !== hoveredSpan) {
          clearHoverStyle();
          target.style.textDecoration = "underline";
          hoveredSpan = target;
        }
      } else {
        clearHoverStyle();
      }
    };

    const handleMouseOut = (e: Event) => {
      if (!hoveredSpan) return;
      const target = (e as MouseEvent).composedPath?.()[0];
      if (target === hoveredSpan) {
        clearHoverStyle();
      }
    };

    // Toggle CSS directly from key events — no React state involved
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        cmdDown = true;
        injectStyle();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") {
        cmdDown = false;
        clearHoverStyle();
        removeStyle();
      }
    };
    const handleBlur = () => {
      cmdDown = false;
      clearHoverStyle();
      removeStyle();
    };

    const handleClick = (e: MouseEvent) => {
      if (e.metaKey) {
        dismissHoverRef.current();
        const url = getUrlAtClick(e);
        if (url) {
          e.preventDefault();
          e.stopPropagation();
          getPlatformServices().opener.openUrl(url);
          return;
        }
        handleSymbolClickRef.current(e);
      }
    };

    // Dismiss popover when the diff scrolls — the symbol moves away from the anchor
    const handleScroll = () => closePopoverRef.current();

    // Attach mouseover/mouseout to shadow root if available, else the node
    const attachHoverListeners = () => {
      const shadow = getShadowRoot();
      const hoverTarget = shadow ?? node;
      hoverTarget.addEventListener("mouseover", handleMouseOver);
      hoverTarget.addEventListener("mouseout", handleMouseOut);
      return hoverTarget;
    };

    // Shadow root may not exist yet (custom element may upgrade later),
    // so attach now and re-attach via MutationObserver if needed.
    let hoverTarget = attachHoverListeners();

    const observer = new MutationObserver(() => {
      const shadow = getShadowRoot();
      if (!shadow) return;
      hoverTarget.removeEventListener("mouseover", handleMouseOver);
      hoverTarget.removeEventListener("mouseout", handleMouseOut);
      hoverTarget = shadow;
      shadow.addEventListener("mouseover", handleMouseOver);
      shadow.addEventListener("mouseout", handleMouseOut);
      observer.disconnect();
    });
    observer.observe(node, { childList: true, subtree: true });

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    node.addEventListener("click", handleClick);
    node.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      clearHoverStyle();
      removeStyle();
      observer.disconnect();
      hoverTarget.removeEventListener("mouseover", handleMouseOver);
      hoverTarget.removeEventListener("mouseout", handleMouseOut);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      node.removeEventListener("click", handleClick);
      node.removeEventListener("scroll", handleScroll);
    };
  }, [scrollNode]);

  // Generate CSS for font injection into pierre/diffs shadow DOM
  const lineHeight = Math.round(codeFontSize * 1.5);
  const fontCSS = `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; --diffs-font-family: ${codeFontFamily}; }`;
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
    pane === "secondary" && isMarkdownFile(filePath) ? "preview" : "code",
  );

  // Language override for syntax highlighting
  const [languageOverride, setLanguageOverride] = useState<
    SupportedLanguages | undefined
  >(undefined);

  // In-file search state
  const [inFileSearchOpen, setInFileSearchOpen] = useState(false);

  // File-level comment editor state
  const [fileCommentEditorOpen, setFileCommentEditorOpen] = useState(false);
  const [editingFileCommentId, setEditingFileCommentId] = useState<
    string | null
  >(null);

  // Handle search highlight — stable callback for InFileSearchBar
  const handleSearchHighlightLine = useCallback((line: number | null) => {
    setHighlightLine(line);
  }, []);

  // Close search and clear highlight
  const handleCloseSearch = useCallback(() => {
    setInFileSearchOpen(false);
    setHighlightLine(null);
  }, []);

  // Stable callback for toolbar to clear highlight on view mode change
  const handleClearHighlight = useCallback(() => {
    setHighlightLine(null);
  }, []);

  // Stable callbacks for split/close actions
  const handleSplitOrRotate = useCallback(() => {
    const state = useReviewStore.getState();
    if (state.secondaryFile !== null) {
      state.setSplitOrientation(
        state.splitOrientation === "horizontal" ? "vertical" : "horizontal",
      );
    } else if (isMarkdownFile(filePath)) {
      setMarkdownViewMode("code");
      state.setSecondaryFile(filePath);
    } else {
      state.openEmptySplit();
    }
  }, [filePath]);

  const handleClose = useCallback(() => {
    useReviewStore.getState().setSelectedFile(null);
  }, []);

  const handleExitWorkingTreeMode = useCallback(() => {
    useReviewStore.setState({
      workingTreeDiffFile: null,
      workingTreeDiffMode: null,
    });
  }, []);

  // All annotations for this file (passed to FileContentRenderer)
  const allFileAnnotations = useMemo(() => {
    return reviewState?.annotations?.filter((a) => a.filePath === filePath);
  }, [reviewState?.annotations, filePath]);

  // File-level annotations only (lineNumber === 0, side === "file")
  const fileAnnotations = useMemo(() => {
    return (
      allFileAnnotations?.filter(
        (a) => a.lineNumber === 0 && a.side === "file",
      ) ?? []
    );
  }, [allFileAnnotations]);

  const handleAddFileComment = useCallback(() => {
    setFileCommentEditorOpen(true);
  }, []);

  const handleSaveFileComment = useCallback(
    (content: string) => {
      addAnnotation(filePath, 0, "file", content);
      setFileCommentEditorOpen(false);
    },
    [addAnnotation, filePath],
  );

  // Navigate to a file linked from markdown preview.
  // Cmd+Click opens in split view; plain click navigates the current pane.
  const handleNavigateToFile = useCallback(
    (repoRelativePath: string, options?: { openInSplit?: boolean }) => {
      const state = useReviewStore.getState();
      const inDiff = state.flatFileList.includes(repoRelativePath);

      if (options?.openInSplit && inDiff) {
        state.openInSplit(repoRelativePath);
      } else if (inDiff) {
        state.setSelectedFile(repoRelativePath);
      } else if (repoPath) {
        state.setExternalFile(repoPath + "/" + repoRelativePath);
      }
    },
    [repoPath],
  );

  // Reset transient UI state when file changes
  useEffect(() => {
    setFileCommentEditorOpen(false);
    setEditingFileCommentId(null);
    setInFileSearchOpen(false);
    setHighlightLine(null);
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

  // Calculate review progress for this file's hunks using the store's hunks
  // (same source as the sidebar) so counts stay consistent.
  // Must be before early returns to comply with React hooks rules.
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const reviewProgress = useMemo(() => {
    const fileHunks = allHunks.filter((h) => h.filePath === filePath);
    const total = fileHunks.length;
    if (total === 0) return { reviewed: 0, total: 0 };
    const trustList = reviewState?.trustList ?? [];
    const reviewed = fileHunks.filter((hunk) =>
      isHunkReviewed(reviewState?.hunks[hunk.id], trustList, {
        autoApproveStaged: reviewState?.autoApproveStaged,
        stagedFilePaths,
        filePath,
      }),
    ).length;
    return { reviewed, total };
  }, [allHunks, filePath, reviewState, stagedFilePaths]);

  // Reset language override when switching files
  useEffect(() => {
    setLanguageOverride(undefined);
  }, [filePath]);

  // Handle scrollTarget (type "line") from search/symbol navigation.
  // Wait until file content is loaded before applying the scroll.
  const scrollTarget = useReviewStore((s) => s.scrollTarget);
  useEffect(() => {
    if (
      scrollTarget?.type === "line" &&
      scrollTarget.filePath === filePath &&
      !loading &&
      fileContent
    ) {
      setHighlightLine(scrollTarget.lineNumber);
      useReviewStore.getState().clearScrollTarget();

      const timeout = setTimeout(() => {
        setHighlightLine(null);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [scrollTarget, filePath, loading, fileContent]);

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
  const fileContentRef = useRef(fileContent);
  fileContentRef.current = fileContent;

  const isStandaloneFile = useReviewStore((s) => s.isStandaloneFile);

  useEffect(() => {
    if (!repoPath) return;

    let cancelled = false;

    const isFileSwitch = prevFilePathRef.current !== filePath;
    prevFilePathRef.current = filePath;

    // Only show spinner on file switch or initial load
    const showSpinner = isFileSwitch || !fileContent;
    if (showSpinner) {
      setLoading(true);
    }
    if (isFileSwitch) {
      setFileContentPath(null);
    }
    setError(null);

    const api = getApiClient();

    // Build the content promise based on the mode
    let contentPromise: Promise<FileContent>;
    if (isExternalFile) {
      // External file from LSP go-to-definition: read by absolute path
      contentPromise = api.readRawFile(externalFilePath);
    } else if (isStandaloneFile) {
      // Standalone file mode: read raw file from disk (no git needed)
      const absolutePath = repoPath + "/" + filePath;
      contentPromise = api.readRawFile(absolutePath);
    } else if (isWorkingTreeMode && workingTreeDiffMode) {
      // When viewing a Git panel file with a specific mode, use the dedicated API
      contentPromise = api.getWorkingTreeFileContent(
        repoPath,
        filePath,
        workingTreeDiffMode === "staged",
      );
    } else if (comparison === null) {
      // Browse mode: get raw file content at HEAD (no diff needed)
      contentPromise = api.getFileRawContent(repoPath, filePath);
    } else {
      const effectiveComparison =
        isWorkingTreeMode && gitStatus
          ? makeComparison("HEAD", gitStatus.currentBranch)
          : comparison;

      contentPromise = api.getFileContent(
        repoPath,
        filePath,
        effectiveComparison,
        isWorkingTreeMode ? undefined : reviewState?.githubPr,
      );
    }

    contentPromise
      .then((result) => {
        if (cancelled) return;

        // Skip re-render if file content hasn't actually changed —
        // preserves scroll position when unrelated files trigger a refresh.
        const prev = fileContentRef.current;
        const isUnchanged =
          prev &&
          !isFileSwitch &&
          result.content === prev.content &&
          result.diffPatch === prev.diffPatch;

        if (isUnchanged) {
          if (showSpinner) setLoading(false);
          return;
        }

        setFileContent(result);
        setFileContentPath(filePath);
        setLoading(false);
        // Sync store hunks with fresh per-file data so the sidebar
        // stays consistent with what the diff view actually renders.
        // Skip sync for working tree diffs, standalone files, and external files.
        if (!isWorkingTreeMode && !isStandaloneFile && !isExternalFile) {
          useReviewStore.getState().syncFileHunks(filePath, result.hunks);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    repoPath,
    filePath,
    comparison,
    fileHunkKey,
    refreshGeneration,
    isWorkingTreeMode,
    workingTreeDiffMode,
    gitStatus,
    isStandaloneFile,
    isExternalFile,
    externalFilePath,
  ]);

  // Minimap hooks — must be before early returns
  const fileHunks = useMemo(
    () => allHunks.filter((h) => h.filePath === filePath),
    [allHunks, filePath],
  );

  const totalLineCount = useMemo(() => {
    const s =
      viewMode === "old" ? fileContent?.oldContent : fileContent?.content;
    if (!s) return 0;
    let count = 1;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [fileContent?.content, fileContent?.oldContent, viewMode]);

  const trustList = reviewState?.trustList ?? [];

  const minimapMarkers = useMemo<MinimapMarker[]>(() => {
    if (!fileContent || totalLineCount === 0) return [];

    // In old/new view modes, build markers from the actual changed lines
    // visible in that view, not from hunk boundaries. A hunk with only
    // additions has nothing to show in "old" mode and vice versa.
    if (viewMode === "old" || viewMode === "new") {
      const isOld = viewMode === "old";
      const lineType = isOld ? "removed" : "added";
      const lineNumKey = isOld ? "oldLineNumber" : "newLineNumber";
      const status = isOld ? "deleted" : "added";

      const markers: MinimapMarker[] = [];
      for (const hunk of fileContent.hunks) {
        // Collect line numbers of changed lines on this side
        const lineNums: number[] = [];
        for (const line of hunk.lines) {
          if (line.type === lineType && line[lineNumKey] != null) {
            lineNums.push(line[lineNumKey]!);
          }
        }
        if (lineNums.length === 0) continue;

        // Find contiguous runs to create tight markers
        lineNums.sort((a, b) => a - b);
        let runStart = lineNums[0];
        let runEnd = lineNums[0];
        for (let i = 1; i <= lineNums.length; i++) {
          if (i < lineNums.length && lineNums[i] === runEnd + 1) {
            runEnd = lineNums[i];
          } else {
            const count = runEnd - runStart + 1;
            markers.push({
              id: `${hunk.id}:${runStart}`,
              topFraction: (runStart - 1) / totalLineCount,
              heightFraction: count / totalLineCount,
              status,
              scrollLine: runStart,
            });
            if (i < lineNums.length) {
              runStart = lineNums[i];
              runEnd = lineNums[i];
            }
          }
        }
      }
      return markers;
    }

    return fileContent.hunks.map((hunk) => {
      const hasAnnotations = allFileAnnotations?.some((a) => {
        if (a.side === "file") return false;
        const start = a.side === "new" ? hunk.newStart : hunk.oldStart;
        const count = a.side === "new" ? hunk.newCount : hunk.oldCount;
        return a.lineNumber >= start && a.lineNumber < start + count;
      });

      return {
        id: hunk.id,
        topFraction: (hunk.newStart - 1) / totalLineCount,
        heightFraction: hunk.newCount / totalLineCount,
        status: getMarkerStatus(hunk.id, reviewState, trustList),
        hasAnnotations: hasAnnotations ?? false,
      };
    });
  }, [
    fileContent,
    totalLineCount,
    reviewState,
    trustList,
    allFileAnnotations,
    viewMode,
  ]);

  const handleMinimapMarkerClick = useCallback(
    (localIndex: number) => {
      if (viewMode === "old" || viewMode === "new") {
        // In old/new mode markers are per-line-run, not per-hunk.
        const marker = minimapMarkers[localIndex];
        if (!marker || marker.scrollLine == null) return;
        setHighlightLine(marker.scrollLine);
      } else {
        const hunk = fileHunks[localIndex];
        if (!hunk) return;
        useReviewStore.setState({
          focusedHunkId: hunk.id,
          scrollTarget: { type: "hunk", hunkId: hunk.id },
        });
      }
    },
    [fileHunks, viewMode, minimapMarkers],
  );

  // Track scroll position to update focused hunk
  useScrollHunkTracking(scrollNode, fileHunks);
  useScrollAnchor(scrollNode, filePath);

  // Check if file is gitignored (from the file tree's allFiles)
  const isGitignored = useReviewStore((s) =>
    hasFileStatus(s.allFiles, filePath, "gitignored"),
  );

  // Memoize contentMode before early returns so hook call order stays constant.
  // When fileContent is null the value is unused but the hook still runs.
  const contentMode = useMemo<ContentMode>(() => {
    if (!fileContent) return PLAIN_MODE;
    const hasChanges = fileContent.hunks.length > 0;
    const contentType = fileContent.contentType || "text";
    const isImage = contentType === "image";
    const isSvgFile = contentType === "svg";
    const showImage =
      isImage ||
      (isSvgFile && svgViewMode === "rendered" && fileContent.imageDataUrl);

    if (isGitignored) return PLAIN_MODE;
    if (showImage) return IMAGE_MODE;
    if (isSvgFile)
      return { type: "svg", hasRendered: !!fileContent.imageDataUrl } as const;
    if (hasChanges) return { type: "diff", viewMode } as const;
    return PLAIN_MODE;
  }, [fileContent, isGitignored, svgViewMode, viewMode]);

  if (loading || fileContentPath !== filePath) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <Spinner className="h-8 w-8 border-2 border-edge-default border-t-status-modified" />
          <span className="text-fg-muted">Loading file…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-xl bg-status-rejected/10 border border-status-rejected/20 p-6 max-w-md text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-status-rejected/20 mx-auto">
            <svg
              className="h-6 w-6 text-status-rejected"
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
          <p className="text-status-rejected text-pretty">{error}</p>
        </div>
      </div>
    );
  }

  if (!fileContent) {
    return null;
  }

  const hasChanges = fileContent.hunks.length > 0;
  const isNewFile =
    hasChanges && !fileContent.oldContent && !fileContent.diffPatch;
  const detectedLanguage = detectLanguage(filePath, fileContent.content);
  const effectiveLanguage = languageOverride ?? detectedLanguage;

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      <FileViewerToolbar
        filePath={filePath}
        contentMode={contentMode}
        hasChanges={hasChanges}
        isNewFile={isNewFile}
        reviewProgress={isWorkingTreeMode ? undefined : reviewProgress}
        effectiveLanguage={effectiveLanguage}
        detectedLanguage={detectedLanguage}
        isLanguageOverridden={languageOverride !== undefined}
        markdownViewMode={markdownViewMode}
        svgViewMode={svgViewMode}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onLanguageChange={setLanguageOverride}
        onMarkdownViewModeChange={setMarkdownViewMode}
        onSvgViewModeChange={setSvgViewMode}
        onClearHighlight={handleClearHighlight}
        onAddFileComment={handleAddFileComment}
        onSplitOrRotate={handleSplitOrRotate}
        isSplitActive={isSplitActive}
        splitOrientation={splitOrientation}
        onClose={handleClose}
        isFocusedPane={isFocusedPane}
        isWorkingTreeMode={isWorkingTreeMode}
        onExitWorkingTreeMode={
          isWorkingTreeMode ? handleExitWorkingTreeMode : undefined
        }
        hasSymbols={hasSymbols}
        isExternalFile={isExternalFile}
        onCloseExternalFile={
          isExternalFile
            ? () => useReviewStore.getState().goBackExternalFile()
            : undefined
        }
      />

      {/* File-level annotations */}
      {(fileAnnotations.length > 0 || fileCommentEditorOpen) && (
        <div className="border-b border-edge/50">
          {fileAnnotations.map((annotation) => {
            const isEditing = editingFileCommentId === annotation.id;
            if (isEditing) {
              return (
                <AnnotationEditor
                  key={annotation.id}
                  initialContent={annotation.content}
                  onSave={(content) => {
                    updateAnnotation(annotation.id, content);
                    setEditingFileCommentId(null);
                  }}
                  onCancel={() => setEditingFileCommentId(null)}
                  onDelete={() => {
                    deleteAnnotation(annotation.id);
                    setEditingFileCommentId(null);
                  }}
                  autoFocus
                />
              );
            }
            return (
              <AnnotationDisplay
                key={annotation.id}
                annotation={annotation}
                onEdit={() => setEditingFileCommentId(annotation.id)}
                onDelete={() => deleteAnnotation(annotation.id)}
              />
            );
          })}
          {fileCommentEditorOpen && (
            <AnnotationEditor
              onSave={handleSaveFileComment}
              onCancel={() => setFileCommentEditorOpen(false)}
              autoFocus
            />
          )}
        </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {inFileSearchOpen && fileContent && (
          <div className="absolute top-0 right-0 z-20 p-2">
            <InFileSearchBar
              content={fileContent.content}
              onHighlightLine={handleSearchHighlightLine}
              onClose={handleCloseSearch}
            />
          </div>
        )}
        {showOutline && hasSymbols && (
          <SymbolOutlinePanel
            filePath={filePath}
            scrollNode={scrollNode}
            symbols={fileSymbols}
          />
        )}
        <VirtualizerContext.Provider value={virtualizer}>
          <div
            ref={setScrollNode}
            className={`min-w-0 flex-1 h-full overflow-auto bg-surface-panel ${
              contentMode.type === "diff" ? "scrollbar-none" : "scrollbar-thin"
            }`}
          >
            {/* Virtualizer.setup() uses root.firstElementChild as the content
                container for resize observation. Do not remove this wrapper.
                Bottom padding gives the virtualizer extra scroll room so
                annotation panels at the end of a file don't clip trailing lines. */}
            <div className="pb-16">
              <FileContentRenderer
                filePath={filePath}
                fileContent={fileContent}
                contentMode={contentMode}
                codeTheme={codeTheme}
                fontCSS={fontCSS}
                effectiveLanguage={effectiveLanguage}
                markdownViewMode={markdownViewMode}
                highlightLine={highlightLine}
                lineHeight={lineHeight}
                onViewInFile={setHighlightLine}
                annotations={allFileAnnotations}
                addAnnotation={addAnnotation}
                updateAnnotation={updateAnnotation}
                deleteAnnotation={deleteAnnotation}
                onNavigateToFile={handleNavigateToFile}
              />
            </div>
          </div>
        </VirtualizerContext.Provider>
        {contentMode.type === "diff" && (
          <DiffMinimap
            markers={minimapMarkers}
            scrollContainer={scrollNode}
            onMarkerClick={handleMinimapMarkerClick}
          />
        )}
      </div>

      <SymbolPopover
        open={popoverOpen}
        position={popoverPosition}
        symbolName={symbolName}
        definitions={definitions}
        references={references}
        loading={symbolLoading}
        onClose={closePopover}
        onNavigateToDefinition={navigateToDefinition}
        onNavigateToReference={navigateToReference}
      />

      <HoverTooltip
        content={popoverOpen ? null : hoverContent}
        position={hoverPos}
        onDismiss={dismissHover}
      />
    </div>
  );
}
