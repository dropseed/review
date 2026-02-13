import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { isHunkReviewed } from "../../types";
import type { DiffHunk, FileContent, HunkGroup, HunkState } from "../../types";
import { DiffView, DiffErrorBoundary } from "../FileViewer/DiffView";
import { NarrativeContent } from "./NarrativeContent";

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

interface GroupDiffViewerProps {
  group: HunkGroup;
  groupIndex: number;
}

export function GroupDiffViewer({
  group,
  groupIndex,
}: GroupDiffViewerProps): ReactNode {
  const hunks = useReviewStore((s) => s.hunks);
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.reviewState?.comparison);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const identicalHunkIds = useReviewStore((s) => s.identicalHunkIds);
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);
  const diffViewMode = useReviewStore((s) => s.diffViewMode);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);

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

  // Identical hunk count
  const identicalCount = useMemo(() => {
    if (group.hunkIds.length === 0) return 0;
    const repId = group.hunkIds[0];
    const siblings = identicalHunkIds.get(repId) ?? [];
    return getUnreviewedIds(
      siblings,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    ).length;
  }, [
    group.hunkIds,
    identicalHunkIds,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);

  const isCompleted = unreviewedIds.length === 0;

  const lineHeight = Math.round(codeFontSize * 1.5);
  const fontSizeCSS = `:host { --diffs-font-size: ${codeFontSize}px; --diffs-line-height: ${lineHeight}px; }`;

  const handleApproveAll = useCallback(() => {
    if (unreviewedIds.length > 0) approveHunkIds(unreviewedIds);
  }, [unreviewedIds, approveHunkIds]);

  const handleRejectAll = useCallback(() => {
    if (unreviewedIds.length > 0) rejectHunkIds(unreviewedIds);
  }, [unreviewedIds, rejectHunkIds]);

  const handleUnapproveAll = useCallback(() => {
    unapproveHunkIds(group.hunkIds);
  }, [group.hunkIds, unapproveHunkIds]);

  const handleApproveIdentical = useCallback(() => {
    if (group.hunkIds.length === 0) return;
    const repId = group.hunkIds[0];
    const siblings = identicalHunkIds.get(repId) ?? [];
    const ids = getUnreviewedIds(
      [repId, ...siblings],
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    );
    if (ids.length > 0) approveHunkIds(ids);
  }, [
    group.hunkIds,
    identicalHunkIds,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
    approveHunkIds,
  ]);

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

  return (
    <div className="space-y-0">
      {/* Group header */}
      <div className="sticky top-0 z-10 bg-stone-900/95 backdrop-blur-sm border-b border-stone-800/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-stone-500 bg-stone-800 px-2 py-0.5 rounded-full tabular-nums">
            {groupIndex + 1}
          </span>
          <h2 className="text-sm font-medium text-stone-200 flex-1 min-w-0 truncate">
            {group.title}
          </h2>
          {isCompleted ? (
            <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
              <CheckIcon />
              Done
            </span>
          ) : (
            <span className="text-xs text-amber-400 tabular-nums font-medium">
              {unreviewedIds.length} remaining
            </span>
          )}
        </div>
        {group.description && (
          <NarrativeContent
            content={group.description}
            className="text-xs text-stone-500 leading-relaxed mt-1.5 ml-9"
          />
        )}
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
        const fileCompleted = fileUnreviewed.length === 0;

        return (
          <div key={filePath} className="border-b border-stone-800/50">
            {/* File path header */}
            <div className="sticky top-[52px] z-[9] bg-stone-900/95 backdrop-blur-sm flex items-center gap-2 px-4 py-1.5 border-b border-stone-800/30">
              <span className="font-mono text-xs text-stone-400 flex-1 truncate">
                {filePath}
              </span>
              {fileCompleted ? (
                <span className="text-emerald-400 shrink-0">
                  <CheckIcon />
                </span>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApproveFileHunks(filePath)}
                    className="px-2 py-0.5 text-xxs font-medium rounded transition-colors
                               bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  >
                    Approve{" "}
                    {fileUnreviewed.length > 1
                      ? `all ${fileUnreviewed.length}`
                      : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectFileHunks(filePath)}
                    className="px-2 py-0.5 text-xxs font-medium rounded transition-colors
                               text-stone-500 hover:text-rose-400 hover:bg-rose-500/10"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>

            {/* Diff content */}
            {isLoading && !fc && (
              <div className="flex items-center gap-2 px-4 py-6 text-stone-500">
                <Spinner className="h-4 w-4" />
                <span className="text-xs">Loading diff...</span>
              </div>
            )}
            {fc && (
              <DiffErrorBoundary
                fallback={
                  <div className="p-4">
                    <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
                      <p className="text-xs text-rose-400">
                        Failed to render diff for {filePath}
                      </p>
                    </div>
                  </div>
                }
              >
                <DiffView
                  diffPatch={fc.diffPatch}
                  viewMode={diffViewMode === "split" ? "split" : "unified"}
                  hunks={fileHunks}
                  theme={codeTheme}
                  fontSizeCSS={fontSizeCSS}
                  fileName={filePath}
                  oldContent={fc.oldContent}
                  newContent={fc.content}
                  expandUnchanged={false}
                />
              </DiffErrorBoundary>
            )}
          </div>
        );
      })}

      {/* Group action bar */}
      <div className="px-4 py-3 flex items-center gap-2 border-b border-stone-800/50">
        {isCompleted ? (
          <button
            type="button"
            onClick={handleUnapproveAll}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                       text-stone-400 hover:text-amber-400 hover:bg-amber-500/10"
          >
            Unapprove all {group.hunkIds.length}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleApproveAll}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                         bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
            >
              Approve all {unreviewedIds.length}
            </button>
            <button
              type="button"
              onClick={handleRejectAll}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                         text-stone-500 hover:text-rose-400 hover:bg-rose-500/10"
            >
              Reject all
            </button>
          </>
        )}
        {!isCompleted && identicalCount > 0 && (
          <button
            type="button"
            onClick={handleApproveIdentical}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                       border border-dashed border-stone-700 text-stone-400
                       hover:border-cyan-500/40 hover:bg-cyan-500/5"
          >
            <svg
              className="w-3.5 h-3.5 text-cyan-400 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Approve {identicalCount} identical
          </button>
        )}
      </div>
    </div>
  );
}
