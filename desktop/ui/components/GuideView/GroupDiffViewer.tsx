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
import { computeGroupFiles } from "../../stores/selectors/groups";
import { getApiClient } from "../../api";
import { isHunkReviewed, EMPTY_TRUST_LIST } from "../../types";
import { countLines } from "../../utils/count-lines";
import type {
  Comparison,
  DiffHunk,
  DiffLine,
  FileContent,
  HunkGroup,
  HunkState,
} from "../../types";
import type { DiffViewMode } from "../../stores/slices/preferencesSlice";
import { DiffView, DiffErrorBoundary } from "../FileViewer/DiffView";
import { ImageViewer } from "../FileViewer/ImageViewer";
import {
  FileDiffStackItem,
  findScrollParent,
} from "../ui/file-diff-stack-item";
import { isImagePath } from "../../utils/file-extension";
import {
  useHunkBlockScrollTarget,
  useCodeFont,
  useResponsiveDiffViewMode,
} from "../../hooks";

import { XIcon } from "../ui/icons";
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
  // The sort happens before the no-expansions early return, not after: a
  // guide-authored group's hunkIds arrive in the order the agent named them
  // (thematic, not positional), and skipping the sort on first render meant
  // the file drew in that order and then re-sorted under the reader the
  // moment any expansion was requested. Already-sorted input (the common
  // case) keeps its identity, since this runs per render, unmemoized.
  const inOrder = fileHunks.every(
    (h, i) => i === 0 || fileHunks[i - 1].oldStart <= h.oldStart,
  );
  const sorted = inOrder
    ? fileHunks
    : [...fileHunks].sort((a, b) => a.oldStart - b.oldStart);

  // No expansions for this file (the common case, and every first render):
  // sorted, non-touching hunks pass through instead of rebuilding every
  // hunk's lines array.
  if (!fileHunks.some((h) => expansionByHunk.has(h.id))) return sorted;

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
 * Build a unified diff patch containing only the specified hunks, under a
 * synthesized header. Deliberately never the real git header: the hunk lines
 * are already in the store, so a synthetic header is what lets a group render
 * before (and without) the per-file `getFileContent` fetch — and a header
 * that switched to git's once that fetch landed would re-parse and visibly
 * re-render a diff already on screen. `/dev/null` marks a side the hunks say
 * doesn't exist, matching what git itself writes for added/deleted files.
 */
function buildFilteredPatch(hunks: DiffHunk[], filePath: string): string {
  const hasOld = hunks.some((h) => h.oldCount > 0);
  const hasNew = hunks.some((h) => h.newCount > 0);
  const diffHeader = `--- ${hasOld ? filePath : "/dev/null"}\n+++ ${hasNew ? filePath : "/dev/null"}\n`;

  const hunkSections = hunks.map((h) => {
    const header = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`;
    const lines = h.lines
      .map((l) => diffLinePrefix(l.type) + l.content)
      .join("\n");
    return header + "\n" + lines;
  });

  return diffHeader + hunkSections.join("\n");
}

/**
 * Per-file content loaded for a section: the data URL for images and the
 * line counts behind the context expanders. Same shape as
 * WorkingTreeMultiFileDiffViewer's — absent means not requested yet.
 */
type FileLoadState =
  { kind: "ok"; content: FileContent } | { kind: "error"; message: string };

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

/**
 * Unmodified lines still hidden on one side of `hunk`, clamped to the file
 * bounds and to the neighbouring group hunk's already-expanded range. Shared
 * by the expander's label and its click handler so the count on screen is
 * exactly what a full expansion would reveal.
 */
function remainingContext(
  hunk: DiffHunk,
  direction: "above" | "below",
  expansionByHunk: Map<string, HunkExpansion>,
  siblings: DiffHunk[],
  counts: { newLines: number; oldLines: number } | undefined,
): number {
  const cur = expansionByHunk.get(hunk.id) ?? { above: 0, below: 0 };

  if (direction === "above") {
    const topNewLine = hunk.newStart - cur.above;
    const topOldLine = hunk.oldStart - cur.above;
    const priorSiblings = siblings
      .filter((h) => h.oldStart < hunk.oldStart)
      .sort((a, b) => a.oldStart - b.oldStart);
    const prevSibling = priorSiblings[priorSiblings.length - 1];
    const prevBelow = prevSibling
      ? (expansionByHunk.get(prevSibling.id)?.below ?? 0)
      : 0;
    const prevOldEndExclusive = prevSibling
      ? prevSibling.oldStart + prevSibling.oldCount + prevBelow
      : 1;
    const room = Math.min(
      topNewLine - 1,
      topOldLine - 1,
      topOldLine - prevOldEndExclusive,
    );
    return Math.max(0, room);
  }

  const newEnd = hunk.newStart + hunk.newCount - 1 + cur.below;
  const oldEnd = hunk.oldStart + hunk.oldCount - 1 + cur.below;
  const newMax = counts?.newLines ?? Infinity;
  const oldMax = counts?.oldLines ?? Infinity;
  const nextSibling = siblings
    .filter((h) => h.oldStart > hunk.oldStart)
    .sort((a, b) => a.oldStart - b.oldStart)[0];
  const nextAbove = nextSibling
    ? (expansionByHunk.get(nextSibling.id)?.above ?? 0)
    : 0;
  const nextOldStart = nextSibling
    ? nextSibling.oldStart - nextAbove
    : oldMax + 1;
  const room = Math.min(
    newMax - newEnd,
    oldMax - oldEnd,
    nextOldStart - 1 - oldEnd,
  );
  return Number.isFinite(room) ? Math.max(0, room) : 0;
}

/** The chevron pierre's own expander uses (`diffs-icon-expand`). */
const EXPAND_CHEVRON = (
  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
  </svg>
);

interface ExpandContextBarProps {
  direction: "above" | "below";
  /** Unmodified lines still hidden in this gap. */
  hiddenLines: number;
  loading?: boolean;
  onExpand: (amount: number) => void;
}

/**
 * Stand-in for pierre's native hunk-separator expander. Group mode renders one
 * hunk at a time from a synthetic patch and deliberately withholds whole-file
 * content — which is what keeps the view group-scoped, but also what stops
 * pierre from drawing its own expander. This mirrors that control's shape so
 * the two diff surfaces read as one: a 32px row inset 8px with 8px of air
 * above and below, a 34px chevron button butted against a rounded label pill
 * reading "N unmodified lines", separated by a 2px sliver of page background.
 * Chevron expands a step; the label expands the whole gap, as pierre's does.
 * The chevron points the way the context will grow — pierre's own arrows read
 * the other way round, and following it here would just be confusing.
 */
function ExpandContextBar({
  direction,
  hiddenLines,
  loading,
  onExpand,
}: ExpandContextBarProps): ReactNode {
  const pill =
    "flex h-full items-center bg-surface-raised/50 text-fg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="my-2 flex h-8 items-center gap-[2px] px-2 text-xs select-none">
      <button
        type="button"
        onClick={() => onExpand(EXPAND_STEP)}
        disabled={loading}
        aria-label={`Expand ${EXPAND_STEP} lines ${direction}`}
        className={`${pill} w-[34px] shrink-0 justify-center rounded-l-md hover:text-fg-secondary`}
      >
        <span className={direction === "above" ? "rotate-180" : undefined}>
          {EXPAND_CHEVRON}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onExpand(hiddenLines)}
        disabled={loading}
        className={`${pill} min-w-0 flex-1 rounded-r-md px-[1ch] text-left hover:underline`}
      >
        <span className="truncate">
          {loading
            ? "Loading…"
            : `${hiddenLines} unmodified line${hiddenLines === 1 ? "" : "s"}`}
        </span>
      </button>
    </div>
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
  const headerActions = fileCompleted ? (
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
  );

  return (
    <FileDiffStackItem
      filePath={filePath}
      isLoading={isLoading}
      headerActions={headerActions}
      autoCollapseSignal={fileCompleted}
      onViewFile={onViewFile}
    >
      {children}
    </FileDiffStackItem>
  );
}

interface GroupDiffViewerProps {
  group: HunkGroup;
  groupIndex?: number;
  headerBadge?: ReactNode;
  /** Absent for the default needs-review view, which has nothing to close into. */
  onClose?: () => void;
}

export function GroupDiffViewer({
  group,
  groupIndex,
  headerBadge,
  onClose,
}: GroupDiffViewerProps): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);

  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);
  const diffViewMode = useReviewStore((s) => s.diffViewMode);
  const setDiffViewMode = useReviewStore((s) => s.setDiffViewMode);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const [fileStates, setFileStates] = useState<Map<string, FileLoadState>>(
    new Map(),
  );
  const [expansionByHunk, setExpansionByHunk] = useState<
    Map<string, HunkExpansion>
  >(new Map());
  const [expandingHunks, setExpandingHunks] = useState<Set<string>>(new Set());
  const lineCacheRef = useRef<LineCache>(new Map());
  const [rootNode, setRootNode] = useState<HTMLDivElement | null>(null);
  // Too narrow for two columns → render unified regardless of preference.
  const responsiveViewMode = useResponsiveDiffViewMode(diffViewMode, rootNode);

  const hunkById = useHunkById();

  const trustList = reviewState?.trustList ?? EMPTY_TRUST_LIST;
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;
  const hunkStates = reviewState?.hunks;

  // This group's files in first-appearance order, each with only the hunks
  // the group claims — shared with the guide sidebar's nested file rows so
  // both surfaces agree on the order.
  const groupFiles = useMemo(
    () => computeGroupFiles(group.hunkIds, hunkById),
    [group.hunkIds, hunkById],
  );

  const filePaths = useMemo(
    () => groupFiles.map((f) => f.filePath),
    [groupFiles],
  );

  const hunksPerFile = useMemo(
    () => new Map(groupFiles.map((f) => [f.filePath, f.hunks])),
    [groupFiles],
  );

  // The diff bodies render straight from the store's hunks — per-file content
  // only supplies what those can't: image data URLs and the full-file line
  // counts behind the context expanders. So it is fetched lazily, per file,
  // as its section approaches the viewport. Eagerly fetching every file up
  // front is what made opening a large group expensive: one git-backed IPC
  // call per file, re-paid on every mount.
  const [wantedFiles, setWantedFiles] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sectionElsRef = useRef(new Set<HTMLElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // One stable callback ref for every section (React ref cleanup handles
  // unmount), with the file path read back off data-section-file.
  const sectionRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    sectionElsRef.current.add(el);
    observerRef.current?.observe(el);
    return () => {
      sectionElsRef.current.delete(el);
      observerRef.current?.unobserve(el);
    };
  }, []);

  // The observer's root must be the Virtualizer's scroll container, not the
  // viewport — with the default root, rootMargin expands a rect the inner
  // scroller still clips to, and the prefetch margin does nothing.
  useEffect(() => {
    if (!rootNode) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setWantedFiles((prev) => {
          let next: Set<string> | null = null;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const fp = (entry.target as HTMLElement).dataset.sectionFile;
            if (fp && !prev.has(fp)) {
              next ??= new Set(prev);
              next.add(fp);
            }
          }
          return next ?? prev;
        });
      },
      // Fetch ahead of the scroll so the expanders and images are usually
      // there by the time their section is.
      { root: findScrollParent(rootNode), rootMargin: "1000px 0px" },
    );
    observerRef.current = observer;
    for (const el of sectionElsRef.current) observer.observe(el);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [rootNode]);

  // Everything ever requested, so a section growing into view fetches once.
  // A failed fetch stays requested (and visible as its error row) rather
  // than silently retrying.
  const requestedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!repoPath || !comparison) return;

    const toLoad = [...wantedFiles].filter(
      (fp) => !requestedRef.current.has(fp),
    );
    if (toLoad.length === 0) return;

    for (const fp of toLoad) requestedRef.current.add(fp);
    const api = getApiClient();
    Promise.all(
      toLoad.map(async (filePath): Promise<[string, FileLoadState]> => {
        try {
          const content = await api.getFileContent(
            repoPath,
            filePath,
            comparison,
          );
          return [filePath, { kind: "ok", content }];
        } catch (err) {
          return [
            filePath,
            {
              kind: "error",
              message: err instanceof Error ? err.message : String(err),
            },
          ];
        }
      }),
    ).then((results) => {
      setFileStates((prev) => new Map([...prev, ...results]));
    });
  }, [repoPath, comparison, wantedFiles]);

  const groupKey = useMemo(() => group.hunkIds.join(","), [group.hunkIds]);
  const patchCacheRef = useRef(new Map<string, string>());
  useEffect(() => {
    setExpansionByHunk(new Map());
    lineCacheRef.current = new Map();
    patchCacheRef.current = new Map();
  }, [groupKey]);

  // Counted once per loaded content (WeakMap-cached), not once per batch —
  // lazy loading means this memo re-runs on every scroll-triggered arrival.
  const lineCountsCacheRef = useRef(
    new WeakMap<FileContent, { newLines: number; oldLines: number }>(),
  );
  const fileLineCounts = useMemo(() => {
    const map = new Map<string, { newLines: number; oldLines: number }>();
    for (const [fp, state] of fileStates) {
      if (state.kind !== "ok") continue;
      let counts = lineCountsCacheRef.current.get(state.content);
      if (!counts) {
        counts = {
          newLines: countLines(state.content.content),
          oldLines: countLines(state.content.oldContent),
        };
        lineCountsCacheRef.current.set(state.content, counts);
      }
      map.set(fp, counts);
    }
    return map;
  }, [fileStates]);

  const handleExpandContext = useCallback(
    async (hunk: DiffHunk, direction: "above" | "below", amount: number) => {
      if (!repoPath || !comparison) return;

      const cur = expansionByHunk.get(hunk.id) ?? { above: 0, below: 0 };
      const counts = fileLineCounts.get(hunk.filePath);
      const siblings = hunksPerFile.get(hunk.filePath) ?? [];

      const maxStep = remainingContext(
        hunk,
        direction,
        expansionByHunk,
        siblings,
        counts,
      );
      if (maxStep <= 0) return;
      const step = Math.min(amount, maxStep);

      let requestStart: number;
      let requestEnd: number;
      if (direction === "above") {
        const topNewLine = hunk.newStart - cur.above;
        requestStart = topNewLine - step;
        requestEnd = topNewLine - 1;
      } else {
        const newEnd = hunk.newStart + hunk.newCount - 1 + cur.below;
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
    [repoPath, comparison, expansionByHunk, fileLineCounts, hunksPerFile],
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

  const { lineHeight, fontCSS } = useCodeFont();

  // Scroll-to-hunk for this surface: hunk blocks are light-DOM wrappers
  // tagged with their source hunk IDs, so targets resolve to a direct
  // scrollIntoView on the wrapper. Re-attempt once file contents load.
  const loadedContentKey = useMemo(
    () => [...fileStates.keys()].join(","),
    [fileStates],
  );
  useHunkBlockScrollTarget(rootNode, group.hunkIds, loadedContentKey);

  const handleApproveAll = useCallback(() => {
    if (unreviewedIds.length > 0) approveHunkIds(unreviewedIds);
  }, [unreviewedIds, approveHunkIds]);

  const handleRejectAll = useCallback(() => {
    if (unreviewedIds.length > 0) rejectHunkIds(unreviewedIds);
  }, [unreviewedIds, rejectHunkIds]);

  const handleUnapproveAll = useCallback(() => {
    unapproveHunkIds(group.hunkIds);
  }, [group.hunkIds, unapproveHunkIds]);

  // Each file's unreviewed ids, computed once per state change rather than
  // per file per render — this is the whole comparison's hunks when the group
  // is the default needs-review view.
  const unreviewedByFile = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { filePath, hunks: fileHunks } of groupFiles) {
      map.set(
        filePath,
        getUnreviewedIds(
          fileHunks.map((h) => h.id),
          hunkById,
          hunkStates,
          trustList,
          autoApproveStaged,
          stagedFilePaths,
        ),
      );
    }
    return map;
  }, [
    groupFiles,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);

  const handleApproveFileHunks = useCallback(
    (filePath: string) => {
      const ids = unreviewedByFile.get(filePath) ?? [];
      if (ids.length > 0) approveHunkIds(ids);
    },
    [unreviewedByFile, approveHunkIds],
  );

  const handleRejectFileHunks = useCallback(
    (filePath: string) => {
      const ids = unreviewedByFile.get(filePath) ?? [];
      if (ids.length > 0) rejectHunkIds(ids);
    },
    [unreviewedByFile, rejectHunkIds],
  );

  // The rebuilt patch string is identical between renders unless the hunk's
  // expanded range changed — which the DiffView key already encodes, so it
  // doubles as the cache key. Skips an O(lines) join per hunk per render.
  function cachedFilteredPatch(hunk: DiffHunk, filePath: string): string {
    const key = `${hunk.id}:${hunk.oldStart}:${hunk.oldCount}:${hunk.newStart}:${hunk.newCount}`;
    let patch = patchCacheRef.current.get(key);
    if (patch === undefined) {
      patch = buildFilteredPatch([hunk], filePath);
      patchCacheRef.current.set(key, patch);
    }
    return patch;
  }

  function renderFileContent(
    fc: FileContent | undefined,
    filePath: string,
    fileHunks: DiffHunk[],
  ): ReactNode {
    if (
      fc &&
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
          const blockHunkIds =
            blockSources.length > 0 ? blockSources.map((h) => h.id) : [hunk.id];

          const firstSourceHunk =
            fileHunks.find((h) => h.id === hunk.id) ?? fileHunks[0];
          const hiddenAbove = remainingContext(
            firstSourceHunk,
            "above",
            expansionByHunk,
            fileHunks,
            counts,
          );
          const hiddenBelow = remainingContext(
            lastSourceHunk,
            "below",
            expansionByHunk,
            fileHunks,
            counts,
          );

          return (
            <Fragment key={hunk.id}>
              {!touchesPrev && hiddenAbove > 0 && (
                <ExpandContextBar
                  direction="above"
                  hiddenLines={hiddenAbove}
                  loading={isLoading}
                  onExpand={(amount) =>
                    handleExpandContext(firstSourceHunk, "above", amount)
                  }
                />
              )}
              {/* data-hunk-ids marks this block as the scroll anchor for its
                  source hunks (consumed by useHunkBlockScrollTarget). */}
              <div data-hunk-ids={blockHunkIds.join("\n")}>
                <DiffView
                  key={`${hunk.id}:${hunk.oldStart}:${hunk.oldCount}:${hunk.newStart}:${hunk.newCount}`}
                  diffPatch={cachedFilteredPatch(hunk, filePath)}
                  viewMode={effectiveViewMode(responsiveViewMode)}
                  hunks={[hunk]}
                  theme={codeTheme}
                  fontCSS={fontCSS}
                  lineHeight={lineHeight}
                  fileName={filePath}
                  expandUnchanged={false}
                />
              </div>
              {i === expandedHunks.length - 1 && hiddenBelow > 0 && (
                <ExpandContextBar
                  direction="below"
                  hiddenLines={hiddenBelow}
                  loading={expandingHunks.has(lastSourceHunk.id)}
                  onExpand={(amount) =>
                    handleExpandContext(lastSourceHunk, "below", amount)
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
    <div ref={setRootNode}>
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
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors shrink-0"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
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
                diffViewMode={responsiveViewMode}
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
                diffViewMode={responsiveViewMode}
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

      {/* File sections. The wrapper div is each section's viewport sentinel —
          entering (or nearing) the viewport is what triggers its content
          fetch. The diff itself renders immediately from the store's hunks. */}
      {groupFiles.map(({ filePath, hunks: fileHunks }) => {
        const loadState = fileStates.get(filePath);
        const fc = loadState?.kind === "ok" ? loadState.content : undefined;
        // An image file's diff *is* its data URL, so its section has nothing
        // to draw until the content arrives (loading row meanwhile) and an
        // error is worth a surface. A text file renders its hunks from the
        // store either way — a failed fetch only costs it the expanders.
        const isImage = isImagePath(filePath);
        const awaitingImage = isImage && loadState === undefined;
        const fileUnreviewed = unreviewedByFile.get(filePath) ?? [];
        return (
          <div key={filePath} ref={sectionRef} data-section-file={filePath}>
            <FileDiffSection
              filePath={filePath}
              isLoading={awaitingImage}
              fileUnreviewed={fileUnreviewed}
              fileCompleted={fileUnreviewed.length === 0}
              onApproveFile={() => handleApproveFileHunks(filePath)}
              onRejectFile={() => handleRejectFileHunks(filePath)}
              onViewFile={() => navigateToBrowse(filePath)}
            >
              {isImage && loadState?.kind === "error" ? (
                <div className="px-4 py-3 text-xs text-status-rejected">
                  Failed to load {filePath}: {loadState.message}
                </div>
              ) : awaitingImage ? null : (
                renderFileContent(fc, filePath, fileHunks)
              )}
            </FileDiffSection>
          </div>
        );
      })}
    </div>
  );
}
