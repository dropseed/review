import { type ReactNode, useMemo } from "react";
import { useReviewStore } from "../../stores";
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

function CategoryPill({
  category,
  count,
}: {
  category: string;
  count: number;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xxs text-stone-400 bg-stone-800 rounded px-1.5 py-0.5">
      <span className="text-stone-300">{category}</span>
      <span className="text-stone-500 tabular-nums">{count}</span>
    </span>
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

  const trustList = reviewState?.trustList ?? [];

  // Compute auto-approved breakdown by category
  const autoApprovedBreakdown = useMemo(() => {
    const categoryMap = new Map<string, number>();
    let total = 0;
    for (const h of hunks) {
      const hunkState = reviewState?.hunks[h.id];
      if (!hunkState) continue;
      if (!hunkState.status && isHunkTrusted(hunkState, trustList)) {
        total++;
        for (const label of hunkState.label) {
          const category = label.split(":")[0] || label;
          categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
        }
      }
    }
    const categories = Array.from(categoryMap.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    return { total, categories };
  }, [hunks, reviewState?.hunks, trustList]);

  // Compute pending hunks breakdown by category
  const pendingBreakdown = useMemo(() => {
    const categoryMap = new Map<string, number>();
    let total = 0;
    let labeled = 0;
    for (const h of hunks) {
      const hunkState = reviewState?.hunks[h.id];
      const status = hunkState?.status;
      if (
        status === "approved" ||
        status === "rejected" ||
        status === "saved_for_later"
      )
        continue;
      if (isHunkTrusted(hunkState, trustList)) continue;
      total++;
      const labels = hunkState?.label ?? [];
      if (labels.length > 0) {
        labeled++;
        for (const label of labels) {
          const category = label.split(":")[0] || label;
          categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
        }
      }
    }
    const categories = Array.from(categoryMap.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    // Only show breakdown if >50% of pending hunks have labels
    const showBreakdown = total > 0 && labeled / total > 0.5;
    return { total, categories, showBreakdown };
  }, [hunks, reviewState?.hunks, trustList]);

  const dirGroups = useMemo(
    () => groupByDirectory(hunks, reviewState),
    [hunks, reviewState],
  );
  const maxDirLines = useMemo(
    () => Math.max(...dirGroups.map((g) => g.added + g.removed), 1),
    [dirGroups],
  );

  return (
    <div className="space-y-4">
      {/* Change Composition */}
      <div className="rounded-lg border border-stone-800 p-4">
        <h3 className="text-xs font-medium text-stone-400 mb-3">
          Change composition
        </h3>
        <div className="space-y-2.5">
          {/* Auto-approved line */}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-stone-300">
                <span className="font-mono font-semibold text-cyan-400 tabular-nums">
                  {autoApprovedBreakdown.total}
                </span>{" "}
                {autoApprovedBreakdown.total === 1 ? "hunk" : "hunks"}{" "}
                auto-approved
              </span>
              {autoApprovedBreakdown.categories.length > 0 && (
                <span className="text-xxs text-stone-600">&mdash;</span>
              )}
              <div className="flex items-center gap-1 flex-wrap">
                {autoApprovedBreakdown.categories.map(([category, count]) => (
                  <CategoryPill
                    key={category}
                    category={category}
                    count={count}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Needs review line */}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-stone-300">
                <span className="font-mono font-semibold text-amber-400 tabular-nums">
                  {pendingBreakdown.total}
                </span>{" "}
                {pendingBreakdown.total === 1 ? "hunk" : "hunks"} need review
              </span>
              {pendingBreakdown.showBreakdown &&
                pendingBreakdown.categories.length > 0 && (
                  <>
                    <span className="text-xxs text-stone-600">&mdash;</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {pendingBreakdown.categories.map(([category, count]) => (
                        <CategoryPill
                          key={category}
                          category={category}
                          count={count}
                        />
                      ))}
                    </div>
                  </>
                )}
            </div>
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
