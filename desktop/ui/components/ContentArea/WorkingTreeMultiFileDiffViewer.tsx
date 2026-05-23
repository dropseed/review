import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtualizer } from "@pierre/diffs/react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import type { FileContent } from "../../types";
import { DiffView, DiffErrorBoundary } from "../FileViewer/DiffView";
import { ImageViewer } from "../FileViewer/ImageViewer";
import { FileDiffStackItem } from "../ui/file-diff-stack-item";

const VIRTUALIZER_STYLE = { overflow: "auto" } as const;

export function WorkingTreeMultiFileDiffViewer(): ReactNode {
  const view = useReviewStore((s) => s.workingTreeMultiView);
  const closeView = useReviewStore((s) => s.closeWorkingTreeMultiView);
  const selectWorkingTreeFile = useReviewStore((s) => s.selectWorkingTreeFile);
  const workingTreePath = useReviewStore((s) => s.worktreePath ?? s.repoPath);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const codeFontFamily = useReviewStore((s) => s.codeFontFamily);
  const diffViewMode = useReviewStore((s) => s.diffViewMode);

  const [fileContents, setFileContents] = useState<Map<string, FileContent>>(
    new Map(),
  );
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  // Tracks which file paths we've already kicked off a request for in the
  // current view. Lives in a ref so the loader effect doesn't depend on
  // `fileContents` (which would re-fire the effect on every successful load).
  const requestedRef = useRef<Set<string>>(new Set());

  // The view changes when mode swaps or the file list changes.
  const viewKey = useMemo(
    () => (view ? `${view.mode}:${view.files.join("|")}` : null),
    [view],
  );

  useEffect(() => {
    // Reset everything when the view target changes so a new file list is
    // refetched from scratch.
    setFileContents(new Map());
    setLoadingFiles(new Set());
    requestedRef.current = new Set();

    if (!view || !workingTreePath) return;
    const toLoad = view.files.filter((fp) => !requestedRef.current.has(fp));
    if (toLoad.length === 0) return;
    for (const fp of toLoad) requestedRef.current.add(fp);

    const api = getApiClient();
    let cancelled = false;
    const cached = view.mode === "staged";

    setLoadingFiles(new Set(toLoad));

    Promise.all(
      toLoad.map(async (filePath) => {
        try {
          const content = await api.getWorkingTreeFileContent(
            workingTreePath,
            filePath,
            cached,
          );
          return { filePath, content };
        } catch (err) {
          console.error(
            `[WorkingTreeMultiFileDiffViewer] Failed to load ${filePath}:`,
            err,
          );
          return { filePath, content: null };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setFileContents((prev) => {
        const next = new Map(prev);
        for (const { filePath, content } of results) {
          if (content) next.set(filePath, content);
        }
        return next;
      });
      setLoadingFiles((prev) => {
        const next = new Set(prev);
        for (const fp of toLoad) next.delete(fp);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [viewKey, view, workingTreePath]);

  const handleOpenFile = useCallback(
    (filePath: string) => {
      if (!view) return;
      selectWorkingTreeFile(filePath, view.mode);
    },
    [view, selectWorkingTreeFile],
  );

  if (!view) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-fg-muted">Nothing to show</p>
      </div>
    );
  }

  const lineHeight = Math.round(codeFontSize * 1.5);
  const fontCSS = `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; --diffs-font-family: ${codeFontFamily}; }`;
  const effectiveViewMode = diffViewMode === "split" ? "split" : "unified";

  function renderFileContent(fc: FileContent, filePath: string): ReactNode {
    if (
      (fc.contentType === "image" || fc.contentType === "svg") &&
      fc.imageDataUrl
    ) {
      return (
        <div className="h-[400px]">
          <ImageViewer
            imageDataUrl={fc.imageDataUrl}
            oldImageDataUrl={fc.oldImageDataUrl}
            filePath={filePath}
            hasChanges={fc.hunks.length > 0}
          />
        </div>
      );
    }

    if (fc.hunks.length === 0) {
      return (
        <div className="px-4 py-3 text-xxs text-fg-muted">
          No changes in this file.
        </div>
      );
    }

    return (
      <DiffErrorBoundary
        fallback={
          <div className="p-4">
            <div className="rounded-lg bg-status-rejected/10 border border-status-rejected/20 p-3">
              <p className="text-xs text-status-rejected">
                Failed to render diff for {filePath}
              </p>
            </div>
          </div>
        }
      >
        <DiffView
          diffPatch={fc.diffPatch}
          viewMode={effectiveViewMode}
          hunks={fc.hunks}
          theme={codeTheme}
          fontCSS={fontCSS}
          fileName={filePath}
          oldContent={fc.oldContent}
          newContent={fc.content}
          expandUnchanged={false}
        />
      </DiffErrorBoundary>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Virtualizer className="flex-1 scrollbar-thin" style={VIRTUALIZER_STYLE}>
        <div>
          {/* Header */}
          <div className="sticky top-0 z-10 bg-surface-panel/95 backdrop-blur-sm border-b border-edge/50 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-status-modified bg-status-modified/10 px-2 py-0.5 rounded-full">
                {view.mode === "staged" ? "Staged" : "Unstaged"}
              </span>
              <h2 className="text-sm font-medium text-fg-secondary flex-1 min-w-0 truncate">
                {view.title}
              </h2>
              <span className="text-xxs text-fg-muted tabular-nums">
                {view.files.length} {view.files.length === 1 ? "file" : "files"}
              </span>
              <button
                type="button"
                onClick={closeView}
                className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors shrink-0"
                aria-label="Close rolling diff"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* File sections */}
          {view.files.map((filePath) => {
            const fc = fileContents.get(filePath);
            const isLoading = loadingFiles.has(filePath);
            return (
              <FileDiffStackItem
                key={filePath}
                filePath={filePath}
                isLoading={isLoading && !fc}
                onViewFile={() => handleOpenFile(filePath)}
              >
                {fc ? renderFileContent(fc, filePath) : null}
              </FileDiffStackItem>
            );
          })}
        </div>
      </Virtualizer>
    </div>
  );
}
