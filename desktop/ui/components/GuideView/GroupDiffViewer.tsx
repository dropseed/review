import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { isHunkReviewed } from "../../types";
import type {
  DiffHunk,
  DiffLine,
  FileContent,
  HunkGroup,
  HunkState,
} from "../../types";
import type { DiffViewMode } from "../../stores/slices/preferencesSlice";
import { DiffView, DiffErrorBoundary } from "../FileViewer/DiffView";
import { UntrackedFileView } from "../FileViewer/UntrackedFileView";
import { ImageViewer } from "../FileViewer/ImageViewer";

function Spinner({ className = "h-4 w-4" }: { className?: string }): ReactNode {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckIcon(): ReactNode {
  return (
    <svg
      className="w-3.5 h-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** Collapse "old"/"new" view modes to "unified" for contexts that only support unified/split. */
function effectiveViewMode(mode: DiffViewMode): "unified" | "split" {
  return mode === "split" ? "split" : "unified";
}

interface ViewModeToggleProps {
  diffViewMode: DiffViewMode;
  onChangeMode: (mode: DiffViewMode) => void;
}

function ViewModeToggle({
  diffViewMode,
  onChangeMode,
}: ViewModeToggleProps): ReactNode {
  const active = effectiveViewMode(diffViewMode);
  return (
    <div className="flex items-center rounded bg-surface-raised/30 p-0.5">
      {(["unified", "split"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChangeMode(mode)}
          className={`rounded px-2 py-0.5 text-xxs font-medium transition-colors ${
            active === mode
              ? "bg-surface-hover/50 text-fg-secondary"
              : "text-fg-muted hover:text-fg-secondary"
          }`}
        >
          {mode === "unified" ? "Unified" : "Split"}
        </button>
      ))}
    </div>
  );
}

function diffLinePrefix(type: DiffLine["type"]): string {
  switch (type) {
    case "added":
      return "+";
    case "removed":
      return "-";
    default:
      return " ";
  }
}

/**
 * Build a unified diff patch containing only the specified hunks.
 * Extracts the diff header (everything before the first @@ line) from
 * the full patch, then reconstructs each hunk from its lines array.
 */
function buildFilteredPatch(fullPatch: string, hunks: DiffHunk[]): string {
  const headerMatch = fullPatch.match(/^([\s\S]*?)(?=^@@\s)/m);
  const diffHeader = headerMatch ? headerMatch[1] : "";

  const hunkSections = hunks.map((h) => {
    const header = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`;
    const lines = h.lines
      .map((l) => diffLinePrefix(l.type) + l.content)
      .join("\n");
    return header + "\n" + lines;
  });

  return diffHeader + hunkSections.join("\n");
}

function getUnreviewedIds(
  ids: string[],
  hunkById: Map<string, DiffHunk>,
  hunkStates: Record<string, HunkState> | undefined,
  trustList: string[],
  autoApproveStaged: boolean,
  stagedFilePaths: Set<string>,
): string[] {
  const result: string[] = [];
  for (const id of ids) {
    const hunk = hunkById.get(id);
    if (
      hunk &&
      !isHunkReviewed(hunkStates?.[id], trustList, {
        autoApproveStaged,
        stagedFilePaths,
        filePath: hunk.filePath,
      })
    ) {
      result.push(id);
    }
  }
  return result;
}

interface FileDiffSectionProps {
  filePath: string;
  isLoading: boolean;
  fileUnreviewed: string[];
  fileCompleted: boolean;
  onApproveFile: () => void;
  onRejectFile: () => void;
  onViewFile: () => void;
  children: ReactNode;
}

function FileDiffSection({
  filePath,
  isLoading,
  fileUnreviewed,
  fileCompleted,
  onApproveFile,
  onRejectFile,
  onViewFile,
  children,
}: FileDiffSectionProps): ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-collapse when all hunks in this file become reviewed
  const prevCompleted = useRef(false);
  useEffect(() => {
    if (fileCompleted && !prevCompleted.current) {
      setIsCollapsed(true);
    }
    prevCompleted.current = fileCompleted;
  }, [fileCompleted]);

  return (
    <div className="border-b border-edge/50">
      {/* File path header */}
      <div className="sticky top-[72px] z-[9] bg-surface-panel/95 backdrop-blur-sm flex items-center gap-2 px-4 py-1.5 border-b border-edge/30">
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="shrink-0 text-fg-muted hover:text-fg-secondary transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="font-mono text-xs text-fg-muted flex-1 truncate text-left hover:text-fg-secondary transition-colors"
        >
          {filePath}
        </button>
        <button
          type="button"
          onClick={onViewFile}
          className="shrink-0 text-fg-muted hover:text-fg-secondary transition-colors p-0.5 rounded hover:bg-surface-hover"
          title="View full file"
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
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
          </svg>
        </button>
        {fileCompleted ? (
          <span className="text-status-approved shrink-0">
            <CheckIcon />
          </span>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onApproveFile}
              className="px-2 py-0.5 text-xxs font-medium rounded transition-colors
                               bg-status-approved/10 text-status-approved hover:bg-status-approved/20"
            >
              Approve{" "}
              {fileUnreviewed.length > 1 ? `all ${fileUnreviewed.length}` : ""}
            </button>
            <button
              type="button"
              onClick={onRejectFile}
              className="px-2 py-0.5 text-xxs font-medium rounded transition-colors
                               text-fg-muted hover:text-status-rejected hover:bg-status-rejected/10"
            >
              Reject
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <>
          {isLoading && (
            <div className="flex items-center gap-2 px-4 py-6 text-fg-muted">
              <Spinner className="h-4 w-4" />
              <span className="text-xs">Loading diff...</span>
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
}

interface GroupDiffViewerProps {
  group: HunkGroup;
  groupIndex?: number;
  headerBadge?: ReactNode;
  onClose: () => void;
}

export function GroupDiffViewer({
  group,
  groupIndex,
  headerBadge,
  onClose,
}: GroupDiffViewerProps): ReactNode {
  const hunks = useReviewStore((s) => s.hunks);
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.reviewState?.comparison);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);

  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);
  const diffViewMode = useReviewStore((s) => s.diffViewMode);
  const setDiffViewMode = useReviewStore((s) => s.setDiffViewMode);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const codeFontFamily = useReviewStore((s) => s.codeFontFamily);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const [fileContents, setFileContents] = useState<Map<string, FileContent>>(
    new Map(),
  );
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());

  const hunkById = useMemo(() => {
    const map = new Map<string, DiffHunk>();
    for (const h of hunks) map.set(h.id, h);
    return map;
  }, [hunks]);

  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;
  const hunkStates = reviewState?.hunks;

  // Get unique file paths from group's hunk IDs, preserving order
  const filePaths = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const id of group.hunkIds) {
      const hunk = hunkById.get(id);
      if (hunk && !seen.has(hunk.filePath)) {
        seen.add(hunk.filePath);
        paths.push(hunk.filePath);
      }
    }
    return paths;
  }, [group.hunkIds, hunkById]);

  // Get hunks per file that belong to this group
  const hunksPerFile = useMemo(() => {
    const map = new Map<string, DiffHunk[]>();
    for (const id of group.hunkIds) {
      const hunk = hunkById.get(id);
      if (!hunk) continue;
      const existing = map.get(hunk.filePath) ?? [];
      existing.push(hunk);
      map.set(hunk.filePath, existing);
    }
    return map;
  }, [group.hunkIds, hunkById]);

  // Load file contents for all files in this group
  useEffect(() => {
    if (!repoPath || !comparison) return;

    const api = getApiClient();
    let cancelled = false;

    // Only load files we don't have yet
    const toLoad = filePaths.filter((fp) => !fileContents.has(fp));
    if (toLoad.length === 0) return;

    setLoadingFiles((prev) => new Set([...prev, ...toLoad]));

    Promise.all(
      toLoad.map(async (filePath) => {
        try {
          const content = await api.getFileContent(
            repoPath,
            filePath,
            comparison,
            reviewState?.githubPr,
          );
          return { filePath, content };
        } catch {
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
  }, [repoPath, comparison, filePaths, fileContents]);

  const unreviewedIds = useMemo(
    () =>
      getUnreviewedIds(
        group.hunkIds,
        hunkById,
        hunkStates,
        trustList,
        autoApproveStaged,
        stagedFilePaths,
      ),
    [
      group.hunkIds,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    ],
  );

  const isCompleted = unreviewedIds.length === 0;

  // Progressive rendering: mount first 2 files immediately, then 1 more per frame
  const [mountedCount, setMountedCount] = useState(
    Math.min(2, filePaths.length),
  );
  useEffect(() => {
    setMountedCount(Math.min(2, filePaths.length));
  }, [filePaths.length]);
  useEffect(() => {
    if (mountedCount >= filePaths.length) return;
    const id = setTimeout(() => {
      setMountedCount((prev) => prev + 1);
    }, 0);
    return () => clearTimeout(id);
  }, [mountedCount, filePaths.length]);

  const lineHeight = Math.round(codeFontSize * 1.5);
  const fontCSS = `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; --diffs-font-family: ${codeFontFamily}; }`;

  const handleApproveAll = useCallback(() => {
    if (unreviewedIds.length > 0) approveHunkIds(unreviewedIds);
  }, [unreviewedIds, approveHunkIds]);

  const handleRejectAll = useCallback(() => {
    if (unreviewedIds.length > 0) rejectHunkIds(unreviewedIds);
  }, [unreviewedIds, rejectHunkIds]);

  const handleUnapproveAll = useCallback(() => {
    unapproveHunkIds(group.hunkIds);
  }, [group.hunkIds, unapproveHunkIds]);

  const handleApproveFileHunks = useCallback(
    (filePath: string) => {
      const fileHunkIds = hunksPerFile.get(filePath)?.map((h) => h.id) ?? [];
      const ids = getUnreviewedIds(
        fileHunkIds,
        hunkById,
        hunkStates,
        trustList,
        autoApproveStaged,
        stagedFilePaths,
      );
      if (ids.length > 0) approveHunkIds(ids);
    },
    [
      hunksPerFile,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
      approveHunkIds,
    ],
  );

  const handleRejectFileHunks = useCallback(
    (filePath: string) => {
      const fileHunkIds = hunksPerFile.get(filePath)?.map((h) => h.id) ?? [];
      const ids = getUnreviewedIds(
        fileHunkIds,
        hunkById,
        hunkStates,
        trustList,
        autoApproveStaged,
        stagedFilePaths,
      );
      if (ids.length > 0) rejectHunkIds(ids);
    },
    [
      hunksPerFile,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
      rejectHunkIds,
    ],
  );

  function renderFileContent(
    fc: FileContent,
    filePath: string,
    fileHunks: DiffHunk[],
  ): ReactNode {
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
            hasChanges={fileHunks.length > 0}
          />
        </div>
      );
    }

    // Untracked (new) files have hunks but no diff patch from git
    if (!fc.diffPatch && fileHunks.length > 0) {
      return (
        <UntrackedFileView
          content={fc.content}
          filePath={filePath}
          hunks={fileHunks}
          theme={codeTheme}
          fontCSS={fontCSS}
        />
      );
    }

    const filteredPatch = buildFilteredPatch(fc.diffPatch, fileHunks);

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
          diffPatch={filteredPatch}
          viewMode={effectiveViewMode(diffViewMode)}
          hunks={fileHunks}
          theme={codeTheme}
          fontCSS={fontCSS}
          fileName={filePath}
          expandUnchanged={false}
        />
      </DiffErrorBoundary>
    );
  }

  return (
    <div>
      {/* Group header */}
      <div className="sticky top-0 z-10 bg-surface-panel/95 backdrop-blur-sm border-b border-edge/50 px-4 py-2.5">
        {/* Row 1: Badge + title + close button */}
        <div className="flex items-center gap-3">
          {groupIndex != null && (
            <span className="text-xs font-medium text-guide bg-guide/10 px-2 py-0.5 rounded-full tabular-nums">
              {groupIndex + 1}
            </span>
          )}
          {headerBadge}
          <h2 className="text-sm font-medium text-fg-secondary flex-1 min-w-0 truncate">
            {group.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors shrink-0"
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
        {/* Row 2: Metadata + action buttons */}
        <div className="flex items-center gap-2 mt-1.5">
          {isCompleted ? (
            <>
              <span className="flex items-center gap-1.5 text-status-approved text-xs font-medium flex-1">
                <CheckIcon />
                Done
              </span>
              <ViewModeToggle
                diffViewMode={diffViewMode}
                onChangeMode={setDiffViewMode}
              />
              <button
                type="button"
                onClick={handleUnapproveAll}
                className="px-2 py-1 text-xs font-medium rounded-md transition-colors
                           text-fg-muted hover:text-fg-secondary hover:bg-surface-hover"
              >
                Reset
              </button>
            </>
          ) : (
            <>
              <span className="text-xxs text-fg-muted tabular-nums flex-1">
                {group.hunkIds.length} hunks · {filePaths.length}{" "}
                {filePaths.length === 1 ? "file" : "files"}
              </span>
              <ViewModeToggle
                diffViewMode={diffViewMode}
                onChangeMode={setDiffViewMode}
              />
              <button
                type="button"
                onClick={handleApproveAll}
                className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors
                           bg-status-approved/15 text-status-approved hover:bg-status-approved/25"
              >
                Approve all {unreviewedIds.length}
              </button>
              <button
                type="button"
                onClick={handleRejectAll}
                className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors
                           text-fg-muted hover:text-status-rejected hover:bg-status-rejected/10"
              >
                Reject all
              </button>
            </>
          )}
        </div>
      </div>

      {/* File sections */}
      {filePaths.map((filePath, fileIndex) => {
        const fc = fileContents.get(filePath);
        const fileHunks = hunksPerFile.get(filePath) ?? [];
        const isLoading = loadingFiles.has(filePath);
        const fileUnreviewed = getUnreviewedIds(
          fileHunks.map((h) => h.id),
          hunkById,
          hunkStates,
          trustList,
          autoApproveStaged,
          stagedFilePaths,
        );
        const deferred = fileIndex >= mountedCount;

        return (
          <FileDiffSection
            key={filePath}
            filePath={filePath}
            isLoading={isLoading && !fc}
            fileUnreviewed={fileUnreviewed}
            fileCompleted={fileUnreviewed.length === 0}
            onApproveFile={() => handleApproveFileHunks(filePath)}
            onRejectFile={() => handleRejectFileHunks(filePath)}
            onViewFile={() => navigateToBrowse(filePath)}
          >
            {fc && !deferred
              ? renderFileContent(fc, filePath, fileHunks)
              : null}
          </FileDiffSection>
        );
      })}
    </div>
  );
}
