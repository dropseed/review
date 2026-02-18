import {
  type ReactNode,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { useFileViewerState } from "./hooks/useFileViewerState";
import type { FileContent } from "../../types";
import { isHunkReviewed, makeComparison } from "../../types";
import { FileContentRenderer } from "./FileContentRenderer";
import { DiffMinimap, getHunkStatus, type MinimapMarker } from "./DiffMinimap";
import { useScrollHunkTracking, useSymbolNavigation } from "../../hooks";
import { InFileSearchBar } from "./InFileSearchBar";
import { detectLanguage, type SupportedLanguages } from "./languageMap";
import { FileViewerToolbar } from "./FileViewerToolbar";
import {
  AnnotationEditor,
  AnnotationDisplay,
} from "./annotations/AnnotationEditor";
import { SymbolPopover } from "./SymbolPopover";
import type { ContentMode } from "./content-mode";

const CMD_HOVER_STYLE_ID = "cmd-hover-style";
const CMD_HOVER_CSS = `code span { cursor: pointer; } code span:hover { text-decoration: underline; }`;

interface FileViewerProps {
  filePath: string;
  isFocusedPane?: boolean;
}

export function FileViewer({
  filePath,
  isFocusedPane,
}: FileViewerProps): ReactNode {
  const {
    comparison,
    repoPath,
    codeTheme,
    codeFontSize,
    reviewState,
    allHunks,
    refreshGeneration,
    focusedHunkIndex,
    scrollToLine,
    clearScrollToLine,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    viewMode,
    classifyingHunkIds,
    workingTreeDiffFile,
    gitStatus,
  } = useFileViewerState();

  const isWorkingTreeMode = workingTreeDiffFile === filePath;
  const workingTreeDiffMode = useReviewStore((s) => s.workingTreeDiffMode);
  const isSplitActive = useReviewStore((s) => s.secondaryFile) !== null;
  const splitOrientation = useReviewStore((s) => s.splitOrientation);

  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);

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

  // Cmd+hover CSS injection and Cmd+Click handling — entirely imperative to
  // avoid re-rendering FileViewer on every Cmd press/release (rerender-use-ref-transient-values).
  const handleSymbolClickRef = useRef(handleSymbolClick);
  handleSymbolClickRef.current = handleSymbolClick;
  const closePopoverRef = useRef(closePopover);
  closePopoverRef.current = closePopover;

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

    // Toggle CSS directly from key events — no React state involved
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") injectStyle();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") removeStyle();
    };
    const handleBlur = () => removeStyle();

    const handleClick = (e: MouseEvent) => {
      if (e.metaKey) handleSymbolClickRef.current(e);
    };

    // Dismiss popover when the diff scrolls — the symbol moves away from the anchor
    const handleScroll = () => closePopoverRef.current();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    node.addEventListener("click", handleClick);
    node.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      removeStyle();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      node.removeEventListener("click", handleClick);
      node.removeEventListener("scroll", handleScroll);
    };
  }, [scrollNode]);

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
    } else {
      state.openEmptySplit();
    }
  }, []);

  const handleClose = useCallback(() => {
    useReviewStore.getState().setSelectedFile(null);
  }, []);

  const handleExitWorkingTreeMode = useCallback(() => {
    useReviewStore.setState({
      workingTreeDiffFile: null,
      workingTreeDiffMode: null,
    });
  }, []);

  // File-level annotations (lineNumber === 0, side === "file")
  const fileAnnotations = useMemo(() => {
    return (
      reviewState?.annotations?.filter(
        (a) =>
          a.filePath === filePath && a.lineNumber === 0 && a.side === "file",
      ) ?? []
    );
  }, [reviewState?.annotations, filePath]);

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

  // Reset transient UI state when file changes
  useEffect(() => {
    setFileCommentEditorOpen(false);
    setEditingFileCommentId(null);
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

    // When viewing a Git panel file with a specific mode, use the dedicated API
    const contentPromise =
      isWorkingTreeMode && workingTreeDiffMode
        ? getApiClient().getWorkingTreeFileContent(
            repoPath,
            filePath,
            workingTreeDiffMode === "staged",
          )
        : (() => {
            // Fallback: combined diff from HEAD vs working tree
            const effectiveComparison =
              isWorkingTreeMode && gitStatus
                ? makeComparison("HEAD", gitStatus.currentBranch)
                : comparison;

            return getApiClient().getFileContent(
              repoPath,
              filePath,
              effectiveComparison,
              isWorkingTreeMode ? undefined : reviewState?.githubPr,
            );
          })();

    contentPromise
      .then((result) => {
        if (!cancelled) {
          setFileContent(result);
          setFileContentPath(filePath);
          setLoading(false);
          // Sync store hunks with fresh per-file data so the sidebar
          // stays consistent with what the diff view actually renders.
          // Skip sync for working tree diffs — these aren't review hunks.
          if (!isWorkingTreeMode) {
            useReviewStore.getState().syncFileHunks(filePath, result.hunks);
          }
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
  }, [
    repoPath,
    filePath,
    comparison,
    fileHunkKey,
    refreshGeneration,
    isWorkingTreeMode,
    workingTreeDiffMode,
    gitStatus,
  ]);

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
          <div className="h-8 w-8 rounded-full border-2 border-edge-default border-t-status-modified animate-spin" />
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
  const isUntracked = hasChanges && !fileContent.diffPatch;
  const contentType = fileContent.contentType || "text";
  const isImage = contentType === "image";
  const isSvg = contentType === "svg";
  const detectedLanguage = detectLanguage(filePath, fileContent.content);
  const effectiveLanguage = languageOverride ?? detectedLanguage;
  const showImageViewer =
    isImage ||
    (isSvg && svgViewMode === "rendered" && fileContent.imageDataUrl);

  const contentMode: ContentMode = (() => {
    if (showImageViewer) return { type: "image" } as const;
    if (isSvg)
      return { type: "svg", hasRendered: !!fileContent.imageDataUrl } as const;
    if (isUntracked) return { type: "untracked" } as const;
    if (hasChanges) return { type: "diff", viewMode } as const;
    return { type: "plain" } as const;
  })();

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      <FileViewerToolbar
        filePath={filePath}
        contentMode={contentMode}
        hasChanges={hasChanges}
        reviewProgress={isWorkingTreeMode ? undefined : reviewProgress}
        effectiveLanguage={effectiveLanguage}
        detectedLanguage={detectedLanguage}
        isLanguageOverridden={languageOverride !== undefined}
        markdownViewMode={markdownViewMode}
        svgViewMode={svgViewMode}
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
        <div
          ref={setScrollNode}
          className={`min-w-0 flex-1 h-full overflow-auto bg-surface-panel ${
            contentMode.type === "diff" || contentMode.type === "untracked"
              ? "scrollbar-none"
              : "scrollbar-thin"
          }`}
        >
          <FileContentRenderer
            filePath={filePath}
            fileContent={fileContent}
            contentMode={contentMode}
            codeTheme={codeTheme}
            fontSizeCSS={fontSizeCSS}
            focusedHunkId={focusedHunkId}
            effectiveLanguage={effectiveLanguage}
            markdownViewMode={markdownViewMode}
            highlightLine={highlightLine}
            lineHeight={lineHeight}
            onViewInFile={setHighlightLine}
            reviewState={reviewState}
            addAnnotation={addAnnotation}
            updateAnnotation={updateAnnotation}
            deleteAnnotation={deleteAnnotation}
          />
        </div>
        {(contentMode.type === "diff" || contentMode.type === "untracked") && (
          <DiffMinimap
            markers={minimapMarkers}
            scrollContainer={scrollNode}
            onMarkerClick={handleMinimapHunkClick}
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
    </div>
  );
}
