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
import { useCodeFont } from "../../hooks";
import { getApiClient } from "../../api";
import type { FileContent } from "../../types";
import { DiffView, DiffErrorBoundary } from "../FileViewer/DiffView";
import { ImageViewer } from "../FileViewer/ImageViewer";
import { FileDiffStackItem } from "../ui/file-diff-stack-item";

const VIRTUALIZER_STYLE = { overflow: "auto" } as const;

type FileLoadState =
  | { kind: "ok"; content: FileContent }
  | { kind: "error"; message: string };

export function WorkingTreeMultiFileDiffViewer(): ReactNode {
  const view = useReviewStore((s) => s.workingTreeMultiView);
  const closeView = useReviewStore((s) => s.closeWorkingTreeMultiView);
  const selectWorkingTreeFile = useReviewStore((s) => s.selectWorkingTreeFile);
  const workingTreePath = useReviewStore((s) => s.worktreePath ?? s.repoPath);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const { lineHeight, fontCSS } = useCodeFont();
  const diffViewMode = useReviewStore((s) => s.diffViewMode);
  const gitStatus = useReviewStore((s) => s.gitStatus);
  const fileVersions = useReviewStore((s) => s.fileVersions);

  // Live file list derived from gitStatus — stays in sync when the user
  // stages/unstages files elsewhere while the rolling diff is open.
  const files = useMemo(() => {
    if (!view || !gitStatus) return [];
    const entries =
      view.mode === "staged" ? gitStatus.staged : gitStatus.unstaged;
    return entries.map((e) => e.path);
  }, [view, gitStatus]);

  const [fileStates, setFileStates] = useState<Map<string, FileLoadState>>(
    new Map(),
  );
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  // The fileVersions value we used the last time we successfully fetched a
  // file. When the watcher bumps a version (file edited on disk), we re-fetch.
  const loadedVersionsRef = useRef<Map<string, number>>(new Map());

  // Reset everything when the view target changes (mode swap or close+reopen).
  const mode = view?.mode ?? null;
  useEffect(() => {
    setFileStates(new Map());
    setLoadingFiles(new Set());
    loadedVersionsRef.current = new Map();
  }, [mode]);

  useEffect(() => {
    if (!view || !workingTreePath) return;
    // Files we either haven't loaded yet or whose on-disk version has changed.
    const toLoad = files.filter((fp) => {
      const lastVersion = loadedVersionsRef.current.get(fp);
      const currentVersion = fileVersions[fp] ?? 0;
      return lastVersion === undefined || lastVersion !== currentVersion;
    });
    if (toLoad.length === 0) return;

    const api = getApiClient();
    let cancelled = false;
    const cached = view.mode === "staged";
    // Snapshot versions at request time so we don't mistakenly mark a file
    // "loaded at version N" if it gets edited again mid-request.
    const requestVersions = new Map<string, number>();
    for (const fp of toLoad) requestVersions.set(fp, fileVersions[fp] ?? 0);

    setLoadingFiles((prev) => {
      const next = new Set(prev);
      for (const fp of toLoad) next.add(fp);
      return next;
    });

    Promise.all(
      toLoad.map(async (filePath) => {
        try {
          const content = await api.getWorkingTreeFileContent(
            workingTreePath,
            filePath,
            cached,
          );
          return {
            filePath,
            state: { kind: "ok" as const, content },
          };
        } catch (err) {
          console.error(
            `[WorkingTreeMultiFileDiffViewer] Failed to load ${filePath}:`,
            err,
          );
          return {
            filePath,
            state: {
              kind: "error" as const,
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setFileStates((prev) => {
        const next = new Map(prev);
        for (const { filePath, state } of results) {
          next.set(filePath, state);
        }
        return next;
      });
      // Record the loaded-at version for both success AND failure so we
      // don't retry a failing file on every unrelated fileVersions bump —
      // we only re-fetch when this file's own version changes again.
      for (const { filePath } of results) {
        loadedVersionsRef.current.set(
          filePath,
          requestVersions.get(filePath) ?? 0,
        );
      }
      setLoadingFiles((prev) => {
        const next = new Set(prev);
        for (const fp of toLoad) next.delete(fp);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [view, workingTreePath, files, fileVersions]);

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
          lineHeight={lineHeight}
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
                {files.length} {files.length === 1 ? "file" : "files"}
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
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-fg-muted">
              <p className="text-sm">
                No {view.mode === "staged" ? "staged" : "unstaged"} changes.
              </p>
            </div>
          ) : (
            files.map((filePath) => {
              const state = fileStates.get(filePath);
              const isLoading = loadingFiles.has(filePath);
              return (
                <FileDiffStackItem
                  key={filePath}
                  filePath={filePath}
                  isLoading={isLoading && state?.kind !== "ok"}
                  onViewFile={() => handleOpenFile(filePath)}
                >
                  {state?.kind === "ok" ? (
                    renderFileContent(state.content, filePath)
                  ) : state?.kind === "error" ? (
                    <div className="px-4 py-3">
                      <div className="rounded bg-status-rejected/10 border border-status-rejected/20 px-3 py-2">
                        <p className="text-xs text-status-rejected">
                          Failed to load diff: {state.message}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </FileDiffStackItem>
              );
            })
          )}
        </div>
      </Virtualizer>
    </div>
  );
}
