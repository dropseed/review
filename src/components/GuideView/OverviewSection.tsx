import { type ReactNode, useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { calculateFileHunkStatus } from "../FilesPanel/FileTree.utils";
import type { DiffHunk, ReviewState } from "../../types";
import { isHunkTrusted } from "../../types";

interface DirGroup {
  dir: string;
  fileCount: number;
  added: number;
  removed: number;
  pendingHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  totalHunks: number;
  firstFilePath: string;
}

function getDirKey(filePath: string): string {
  const parts = filePath.split("/");
  const dirParts = parts.slice(0, Math.min(parts.length - 1, 2));
  return dirParts.length > 0 ? dirParts.join("/") + "/" : "(root)";
}

function groupByDirectory(
  hunks: DiffHunk[],
  reviewState: ReviewState | null,
): DirGroup[] {
  const trustList = reviewState?.trustList ?? [];

  const groups = new Map<string, DirGroup>();
  const dirFiles = new Map<string, Set<string>>();
  const fileLineStats = new Map<string, { added: number; removed: number }>();

  // Single pass: aggregate per-file line stats, per-directory hunk counts, and file sets
  for (const h of hunks) {
    const dir = getDirKey(h.filePath);

    // Line stats per file
    const fileStat = fileLineStats.get(h.filePath) ?? { added: 0, removed: 0 };
    for (const line of h.lines) {
      if (line.type === "added") fileStat.added++;
      else if (line.type === "removed") fileStat.removed++;
    }
    fileLineStats.set(h.filePath, fileStat);

    // Track unique files per directory
    if (!dirFiles.has(dir)) dirFiles.set(dir, new Set());
    dirFiles.get(dir)!.add(h.filePath);

    // Directory group aggregation
    const existing = groups.get(dir) ?? {
      dir,
      fileCount: 0,
      added: 0,
      removed: 0,
      pendingHunks: 0,
      trustedHunks: 0,
      approvedHunks: 0,
      totalHunks: 0,
      firstFilePath: h.filePath,
    };

    existing.totalHunks++;

    const hunkState = reviewState?.hunks[h.id];
    if (hunkState?.status === "approved") {
      existing.approvedHunks++;
    } else if (
      hunkState?.status === "rejected" ||
      isHunkTrusted(hunkState, trustList)
    ) {
      existing.trustedHunks++;
    } else if (hunkState?.status !== "saved_for_later") {
      existing.pendingHunks++;
    }

    groups.set(dir, existing);
  }

  // Finalize file counts and line stats per directory
  for (const [dir, fileSet] of dirFiles) {
    const group = groups.get(dir);
    if (!group) continue;
    group.fileCount = fileSet.size;
    let added = 0;
    let removed = 0;
    for (const fp of fileSet) {
      const s = fileLineStats.get(fp);
      if (s) {
        added += s.added;
        removed += s.removed;
      }
    }
    group.added = added;
    group.removed = removed;
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.pendingHunks - a.pendingHunks || b.totalHunks - a.totalHunks,
  );
}

function ReviewSnapshotStat({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-sm font-semibold tabular-nums ${color}`}>
        {value}
      </span>
      <span className="text-xs text-stone-500">{label}</span>
    </div>
  );
}

interface DirectoryBarProps {
  group: DirGroup;
  maxLines: number;
  onClick: () => void;
}

function DirectoryBar({ group, maxLines, onClick }: DirectoryBarProps) {
  const totalLines = group.added + group.removed;
  const barWidth = maxLines > 0 ? (totalLines / maxLines) * 100 : 0;

  // Review-status proportions for the bar
  const trustedFrac =
    group.totalHunks > 0 ? (group.trustedHunks / group.totalHunks) * 100 : 0;
  const approvedFrac =
    group.totalHunks > 0 ? (group.approvedHunks / group.totalHunks) * 100 : 0;
  const pendingFrac = 100 - trustedFrac - approvedFrac;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full rounded-md px-1 -mx-1 py-0.5 hover:bg-stone-800/40 transition-colors group"
    >
      <span className="text-xs text-stone-400 font-mono w-36 truncate shrink-0 text-left group-hover:text-stone-200 transition-colors">
        {group.dir}
      </span>
      <div className="flex-1 h-2 bg-stone-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full flex"
          style={{ width: `${Math.max(barWidth, 2)}%` }}
        >
          {trustedFrac > 0 && (
            <div
              className="h-full bg-cyan-500/60"
              style={{ width: `${trustedFrac}%` }}
            />
          )}
          {approvedFrac > 0 && (
            <div
              className="h-full bg-emerald-500/60"
              style={{ width: `${approvedFrac}%` }}
            />
          )}
          {pendingFrac > 0 && (
            <div
              className="h-full bg-stone-600/60"
              style={{ width: `${pendingFrac}%` }}
            />
          )}
        </div>
      </div>
      {group.pendingHunks > 0 ? (
        <span className="text-xxs text-amber-400/70 tabular-nums w-14 text-right shrink-0">
          {group.pendingHunks} pending
        </span>
      ) : (
        <span className="text-xxs text-emerald-400/70 tabular-nums w-14 text-right shrink-0">
          done
        </span>
      )}
    </button>
  );
}

export function OverviewSection(): ReactNode {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const progress = useReviewProgress();
  const fileHunkStatusMap = useMemo(
    () => calculateFileHunkStatus(hunks, reviewState),
    [hunks, reviewState],
  );

  const filesNeedingReview = useMemo(() => {
    let count = 0;
    for (const status of fileHunkStatusMap.values()) {
      if (status.pending > 0) count++;
    }
    return count;
  }, [fileHunkStatusMap]);

  const trustPatternsActive = reviewState?.trustList.length ?? 0;

  const dirGroups = useMemo(
    () => groupByDirectory(hunks, reviewState),
    [hunks, reviewState],
  );
  const maxDirLines = useMemo(
    () => Math.max(...dirGroups.map((g) => g.added + g.removed), 1),
    [dirGroups],
  );

  const reviewedPercent =
    progress.totalHunks > 0
      ? Math.round((progress.reviewedHunks / progress.totalHunks) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Review Snapshot */}
      <div className="rounded-lg border border-stone-800 p-4">
        <h3 className="text-xs font-medium text-stone-400 mb-3">
          Review snapshot
        </h3>
        <div className="space-y-3">
          {/* Hunks reviewed progress bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-400">
                <span className="font-mono font-semibold text-stone-200 tabular-nums">
                  {progress.reviewedHunks}
                </span>{" "}
                of{" "}
                <span className="font-mono tabular-nums">
                  {progress.totalHunks}
                </span>{" "}
                hunks reviewed
              </span>
              <span className="text-xxs text-stone-500 tabular-nums">
                {reviewedPercent}%
              </span>
            </div>
            <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden flex">
              {progress.trustedHunks > 0 && (
                <div
                  className="bg-cyan-500 transition-all duration-500"
                  style={{
                    width: `${(progress.trustedHunks / progress.totalHunks) * 100}%`,
                  }}
                />
              )}
              {progress.approvedHunks > 0 && (
                <div
                  className="bg-emerald-500 transition-all duration-500"
                  style={{
                    width: `${(progress.approvedHunks / progress.totalHunks) * 100}%`,
                  }}
                />
              )}
              {progress.rejectedHunks > 0 && (
                <div
                  className="bg-rose-500 transition-all duration-500"
                  style={{
                    width: `${(progress.rejectedHunks / progress.totalHunks) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>

          {/* Stat pills */}
          <div className="flex items-center gap-6 flex-wrap">
            <ReviewSnapshotStat
              value={filesNeedingReview}
              label={
                filesNeedingReview === 1
                  ? "file needs review"
                  : "files need review"
              }
              color={
                filesNeedingReview > 0 ? "text-amber-400" : "text-emerald-400"
              }
            />
            {trustPatternsActive > 0 && (
              <ReviewSnapshotStat
                value={trustPatternsActive}
                label={
                  trustPatternsActive === 1
                    ? "trust pattern active"
                    : "trust patterns active"
                }
                color="text-cyan-400"
              />
            )}
            {progress.rejectedHunks > 0 && (
              <ReviewSnapshotStat
                value={progress.rejectedHunks}
                label={
                  progress.rejectedHunks === 1
                    ? "hunk rejected"
                    : "hunks rejected"
                }
                color="text-rose-400"
              />
            )}
          </div>
        </div>
      </div>

      {/* Where changes are */}
      {dirGroups.length > 0 && (
        <div className="rounded-lg border border-stone-800 p-4">
          <h3 className="text-xs font-medium text-stone-400 mb-3">
            Where changes are
          </h3>
          <div className="space-y-0.5">
            {dirGroups.map((group) => (
              <DirectoryBar
                key={group.dir}
                group={group}
                maxLines={maxDirLines}
                onClick={() => navigateToBrowse(group.firstFilePath)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
