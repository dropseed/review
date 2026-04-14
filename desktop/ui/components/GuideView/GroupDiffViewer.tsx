import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../../stores";
import { useHunkById } from "../../stores/selectors/hunks";
import { getApiClient } from "../../api";
import { isHunkReviewed } from "../../types";
import { countLines } from "../../utils/count-lines";
import type {
  Comparison,
  DiffHunk,
  DiffLine,
  FileContent,
  GitHubPrRef,
  HunkGroup,
  HunkState,
} from "../../types";
import type { DiffViewMode } from "../../stores/slices/preferencesSlice";
import { DiffView, DiffErrorBoundary } from "../FileViewer/DiffView";
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

const EXPAND_STEP = 20;

type HunkExpansion = { above: number; below: number };

type LineCache = Map<string, string>;

// Context lines are fetched from the head ref, so keyed by new-file line number.
function cacheKey(filePath: string, newLine: number): string {
  return `${filePath}:${newLine}`;
}

/**
 * Return file hunks with their context expanded per the user's requests,
 * merging any hunks whose expanded ranges touch or overlap.
 */
function applyExpansions(
  fileHunks: DiffHunk[],
  expansionByHunk: Map<string, HunkExpansion>,
  lineCache: LineCache,
): DiffHunk[] {
  if (fileHunks.length === 0) return fileHunks;

  const sorted = [...fileHunks].sort((a, b) => a.oldStart - b.oldStart);

  const expanded = sorted.map((hunk) => {
    const exp = expansionByHunk.get(hunk.id) ?? { above: 0, below: 0 };

    const aboveLines: DiffLine[] = [];
    for (let i = exp.above; i >= 1; i--) {
      const oldNum = hunk.oldStart - i;
      const newNum = hunk.newStart - i;
      if (oldNum < 1 || newNum < 1) continue;
      const content = lineCache.get(cacheKey(hunk.filePath, newNum));
      if (content === undefined) continue;
      aboveLines.push({
        type: "context",
        content,
        oldLineNumber: oldNum,
        newLineNumber: newNum,
      });
    }

    const oldEnd = hunk.oldStart + hunk.oldCount - 1;
    const newEnd = hunk.newStart + hunk.newCount - 1;
    const belowLines: DiffLine[] = [];
    for (let i = 1; i <= exp.below; i++) {
      const oldNum = oldEnd + i;
      const newNum = newEnd + i;
      const content = lineCache.get(cacheKey(hunk.filePath, newNum));
      if (content === undefined) continue;
      belowLines.push({
        type: "context",
        content,
        oldLineNumber: oldNum,
        newLineNumber: newNum,
      });
    }

    const addedAbove = aboveLines.length;
    const addedBelow = belowLines.length;
    return {
      ...hunk,
      oldStart: hunk.oldStart - addedAbove,
      newStart: hunk.newStart - addedAbove,
      oldCount: hunk.oldCount + addedAbove + addedBelow,
      newCount: hunk.newCount + addedAbove + addedBelow,
      lines: [...aboveLines, ...hunk.lines, ...belowLines],
    };
  });

  const merged: DiffHunk[] = [];
  for (const h of expanded) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(h);
      continue;
    }
    const prevOldEndExclusive = prev.oldStart + prev.oldCount;
    if (h.oldStart > prevOldEndExclusive) {
      merged.push(h);
      continue;
    }
    const prevNewEndExclusive = prev.newStart + prev.newCount;
    const tail = h.lines.filter((l) => {
      if (l.type === "added") {
        return (l.newLineNumber ?? 0) >= prevNewEndExclusive;
      }
      return (l.oldLineNumber ?? 0) >= prevOldEndExclusive;
    });
    const hOldEndExclusive = h.oldStart + h.oldCount;
    const hNewEndExclusive = h.newStart + h.newCount;
    const combinedOldEnd = Math.max(prevOldEndExclusive, hOldEndExclusive);
    const combinedNewEnd = Math.max(prevNewEndExclusive, hNewEndExclusive);
    merged[merged.length - 1] = {
      ...prev,
      oldCount: combinedOldEnd - prev.oldStart,
      newCount: combinedNewEnd - prev.newStart,
      lines: [...prev.lines, ...tail],
    };
  }
  return merged;
}

/**
 * Build a unified diff patch containing only the specified hunks.
 * Extracts the diff header (everything before the first @@ line) from
 * the full patch, then reconstructs each hunk from its lines array.
 * When the source patch is empty (e.g., untracked/new files), generates
 * a synthetic header so the patch-only rendering path works correctly.
 */
function buildFilteredPatch(
  fullPatch: string,
  hunks: DiffHunk[],
  filePath: string,
): string {
  let diffHeader: string;
  if (fullPatch) {
    const headerMatch = fullPatch.match(/^([\s\S]*?)(?=^@@\s)/m);
    diffHeader = headerMatch ? headerMatch[1] : "";
  } else {
    diffHeader = `--- /dev/null\n+++ ${filePath}\n`;
  }

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

interface ExpandContextBarProps {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

function ExpandContextBar({
  label,
  disabled,
  loading,
  onClick,
}: ExpandContextBarProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full px-4 py-1 text-xxs font-mono text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/40 disabled:opacity-40 disabled:cursor-not-allowed border-y border-edge/30 bg-surface-raised/20 text-center transition-colors"
    >
      {loading ? "Loading…" : label}
    </button>
  );
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
  const [expansionByHunk, setExpansionByHunk] = useState<
    Map<string, HunkExpansion>
  >(new Map());
  const [expandingHunks, setExpandingHunks] = useState<Set<string>>(new Set());
  const lineCacheRef = useRef<LineCache>(new Map());

  const hunkById = useHunkById();

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

  const groupKey = useMemo(() => group.hunkIds.join(","), [group.hunkIds]);
  useEffect(() => {
    setExpansionByHunk(new Map());
    lineCacheRef.current = new Map();
  }, [groupKey]);

  const fileLineCounts = useMemo(() => {
    const map = new Map<string, { newLines: number; oldLines: number }>();
    for (const [fp, fc] of fileContents) {
      map.set(fp, {
        newLines: countLines(fc.content),
        oldLines: countLines(fc.oldContent),
      });
    }
    return map;
  }, [fileContents]);

  const handleExpandContext = useCallback(
    async (hunk: DiffHunk, direction: "above" | "below", amount: number) => {
      if (!repoPath || !comparison) return;

      const cur = expansionByHunk.get(hunk.id) ?? { above: 0, below: 0 };
      const counts = fileLineCounts.get(hunk.filePath);
      const siblings = hunksPerFile.get(hunk.filePath) ?? [];

      let requestStart: number;
      let requestEnd: number;
      if (direction === "above") {
        const topNewLine = hunk.newStart - cur.above;
        const topOldLine = hunk.oldStart - cur.above;
        // Don't cross into the previous group hunk's expanded range.
        const priorSiblings = [...siblings]
          .filter((h) => h.oldStart < hunk.oldStart)
          .sort((a, b) => a.oldStart - b.oldStart);
        const prevSibling = priorSiblings[priorSiblings.length - 1];
        const prevBelow = prevSibling
          ? (expansionByHunk.get(prevSibling.id)?.below ?? 0)
          : 0;
        const prevOldEndExclusive = prevSibling
          ? prevSibling.oldStart + prevSibling.oldCount + prevBelow
          : 1;
        const limitByPrev = topOldLine - prevOldEndExclusive;
        const maxStep = Math.min(topNewLine - 1, topOldLine - 1, limitByPrev);
        if (maxStep <= 0) return;
        const step = Math.min(amount, maxStep);
        requestStart = topNewLine - step;
        requestEnd = topNewLine - 1;
      } else {
        const newEnd = hunk.newStart + hunk.newCount - 1 + cur.below;
        const oldEnd = hunk.oldStart + hunk.oldCount - 1 + cur.below;
        const newMax = counts?.newLines ?? Infinity;
        const oldMax = counts?.oldLines ?? Infinity;
        // Don't cross into the next group hunk's expanded range.
        const nextSibling = siblings
          .filter((h) => h.oldStart > hunk.oldStart)
          .sort((a, b) => a.oldStart - b.oldStart)[0];
        const nextAbove = nextSibling
          ? (expansionByHunk.get(nextSibling.id)?.above ?? 0)
          : 0;
        const nextOldStart = nextSibling
          ? nextSibling.oldStart - nextAbove
          : oldMax + 1;
        const limitByNext = nextOldStart - 1 - oldEnd;
        const maxStep = Math.min(newMax - newEnd, oldMax - oldEnd, limitByNext);
        if (maxStep <= 0) return;
        const step = Math.min(amount, maxStep);
        requestStart = newEnd + 1;
        requestEnd = newEnd + step;
      }

      setExpandingHunks((prev) => new Set(prev).add(hunk.id));
      try {
        const api = getApiClient();
        const result = await api.getExpandedContext(
          repoPath,
          hunk.filePath,
          comparison as Comparison,
          requestStart,
          requestEnd,
          reviewState?.githubPr as GitHubPrRef | undefined,
        );
        for (let i = 0; i < result.lines.length; i++) {
          lineCacheRef.current.set(
            cacheKey(hunk.filePath, result.startLine + i),
            result.lines[i],
          );
        }
        const added = result.lines.length;
        if (added > 0) {
          setExpansionByHunk((prev) => {
            const next = new Map(prev);
            const existing = next.get(hunk.id) ?? { above: 0, below: 0 };
            next.set(hunk.id, {
              above:
                direction === "above" ? existing.above + added : existing.above,
              below:
                direction === "below" ? existing.below + added : existing.below,
            });
            return next;
          });
        }
      } catch (err) {
        console.error("[GroupDiffViewer] Failed to expand context:", err);
      } finally {
        setExpandingHunks((prev) => {
          const next = new Set(prev);
          next.delete(hunk.id);
          return next;
        });
      }
    },
    [
      repoPath,
      comparison,
      expansionByHunk,
      fileLineCounts,
      hunksPerFile,
      reviewState?.githubPr,
    ],
  );

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

    const expandedHunks = applyExpansions(
      fileHunks,
      expansionByHunk,
      lineCacheRef.current,
    );
    const counts = fileLineCounts.get(filePath);
    const newMax = counts?.newLines ?? Infinity;

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
        {expandedHunks.map((hunk, i) => {
          const prev = i > 0 ? expandedHunks[i - 1] : null;
          const newEnd = hunk.newStart + hunk.newCount - 1;
          const atTopOfFile = hunk.newStart <= 1 || hunk.oldStart <= 1;
          const atBottomOfFile = newEnd >= newMax;
          const touchesPrev =
            prev != null && hunk.newStart <= prev.newStart + prev.newCount;
          const isLoading = expandingHunks.has(hunk.id);

          // Find the underlying group hunk id(s) that belong to this expanded
          // block. After merging, `hunk.id` is the id of the first source hunk.
          // Expanding "above" is wired to that hunk's id; "below" is wired to
          // the LAST merged hunk so it extends at the correct boundary.
          const blockSources = [...fileHunks]
            .filter(
              (h) =>
                h.oldStart >= hunk.oldStart &&
                h.oldStart + h.oldCount <= hunk.oldStart + hunk.oldCount,
            )
            .sort((a, b) => a.oldStart - b.oldStart);
          const lastSourceHunk =
            blockSources[blockSources.length - 1] ??
            fileHunks.find((h) => h.id === hunk.id)!;

          return (
            <Fragment key={hunk.id}>
              {!touchesPrev && !atTopOfFile && (
                <ExpandContextBar
                  label={`↑ Expand ${EXPAND_STEP} lines above`}
                  loading={isLoading}
                  onClick={() =>
                    handleExpandContext(
                      fileHunks.find((h) => h.id === hunk.id) ?? fileHunks[0],
                      "above",
                      EXPAND_STEP,
                    )
                  }
                />
              )}
              <DiffView
                key={`${hunk.id}:${hunk.oldStart}:${hunk.oldCount}:${hunk.newStart}:${hunk.newCount}`}
                diffPatch={buildFilteredPatch(fc.diffPatch, [hunk], filePath)}
                viewMode={effectiveViewMode(diffViewMode)}
                hunks={[hunk]}
                theme={codeTheme}
                fontCSS={fontCSS}
                fileName={filePath}
                expandUnchanged={false}
              />
              {i === expandedHunks.length - 1 && !atBottomOfFile && (
                <ExpandContextBar
                  label={`↓ Expand ${EXPAND_STEP} lines below`}
                  loading={expandingHunks.has(lastSourceHunk.id)}
                  onClick={() =>
                    handleExpandContext(lastSourceHunk, "below", EXPAND_STEP)
                  }
                />
              )}
            </Fragment>
          );
        })}
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
      {filePaths.map((filePath) => {
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
            {fc ? renderFileContent(fc, filePath, fileHunks) : null}
          </FileDiffSection>
        );
      })}
    </div>
  );
}
