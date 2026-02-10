import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { flattenFilesWithStatus } from "../../stores/types";
import type { DiffHunk, FileEntry } from "../../types";

interface FileStatusCounts {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
}

function buildFileStatusMap(files: FileEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { path, status } of flattenFilesWithStatus(files)) {
    if (status) map.set(path, status);
  }
  return map;
}

function countFilesByStatus(
  hunks: DiffHunk[],
  statusMap: Map<string, string>,
): FileStatusCounts & { total: number } {
  const counts: FileStatusCounts = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
  };

  const seen = new Set<string>();
  for (const h of hunks) {
    if (seen.has(h.filePath)) continue;
    seen.add(h.filePath);

    switch (statusMap.get(h.filePath)) {
      case "added":
        counts.added++;
        break;
      case "deleted":
        counts.deleted++;
        break;
      case "renamed":
        counts.renamed++;
        break;
      default:
        counts.modified++;
    }
  }

  return { ...counts, total: seen.size };
}

interface DirGroup {
  dir: string;
  fileCount: number;
  added: number;
  removed: number;
}

function groupByDirectory(hunks: DiffHunk[]): DirGroup[] {
  const fileLineStats = new Map<string, { added: number; removed: number }>();
  for (const h of hunks) {
    const existing = fileLineStats.get(h.filePath) ?? {
      added: 0,
      removed: 0,
    };
    for (const line of h.lines) {
      if (line.type === "added") existing.added++;
      else if (line.type === "removed") existing.removed++;
    }
    fileLineStats.set(h.filePath, existing);
  }

  const groups = new Map<string, DirGroup>();
  for (const [filePath, stats] of fileLineStats) {
    const parts = filePath.split("/");
    const dirParts = parts.slice(0, Math.min(parts.length - 1, 2));
    const dir = dirParts.length > 0 ? dirParts.join("/") + "/" : "(root)";

    const existing = groups.get(dir) ?? {
      dir,
      fileCount: 0,
      added: 0,
      removed: 0,
    };
    existing.fileCount++;
    existing.added += stats.added;
    existing.removed += stats.removed;
    groups.set(dir, existing);
  }

  return Array.from(groups.values()).sort((a, b) => b.fileCount - a.fileCount);
}

const FILE_STATUS_DISPLAY: {
  key: keyof FileStatusCounts;
  label: string;
  color: string;
}[] = [
  { key: "modified", label: "modified", color: "text-amber-400" },
  { key: "deleted", label: "deleted", color: "text-rose-400" },
  { key: "added", label: "new", color: "text-emerald-400" },
  { key: "renamed", label: "renamed", color: "text-violet-400" },
];

interface DirectoryBarProps {
  group: DirGroup;
  maxLines: number;
}

function DirectoryBar({ group, maxLines }: DirectoryBarProps) {
  const totalLines = group.added + group.removed;
  const barWidth = maxLines > 0 ? (totalLines / maxLines) * 100 : 0;
  const addedFrac = totalLines > 0 ? (group.added / totalLines) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-stone-400 font-mono w-36 truncate shrink-0">
        {group.dir}
      </span>
      <span className="text-xxs text-stone-600 tabular-nums w-8 text-right shrink-0">
        {group.fileCount}f
      </span>
      <div className="flex-1 h-2 bg-stone-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full flex"
          style={{ width: `${Math.max(barWidth, 2)}%` }}
        >
          <div
            className="h-full bg-emerald-500/60"
            style={{ width: `${addedFrac}%` }}
          />
          <div
            className="h-full bg-rose-500/60"
            style={{ width: `${100 - addedFrac}%` }}
          />
        </div>
      </div>
      <span className="text-xxs text-stone-600 tabular-nums w-16 text-right shrink-0">
        +{group.added} &minus;{group.removed}
      </span>
    </div>
  );
}

export function OverviewSection() {
  const files = useReviewStore((s) => s.files);
  const hunks = useReviewStore((s) => s.hunks);

  const statusMap = useMemo(() => buildFileStatusMap(files), [files]);
  const fileStatus = useMemo(
    () => countFilesByStatus(hunks, statusMap),
    [hunks, statusMap],
  );
  const dirGroups = useMemo(() => groupByDirectory(hunks), [hunks]);
  const maxDirLines = useMemo(
    () => Math.max(...dirGroups.map((g) => g.added + g.removed), 1),
    [dirGroups],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-800 p-4">
        <h3 className="text-xs font-medium text-stone-400 mb-3">
          File breakdown
        </h3>
        <div className="flex items-center gap-6 flex-wrap">
          {FILE_STATUS_DISPLAY.map(({ key, label, color }) => {
            const count = fileStatus[key];
            if (count === 0) return null;
            return (
              <div key={key} className="flex items-center gap-2">
                <span
                  className={`font-mono text-sm font-semibold tabular-nums ${color}`}
                >
                  {count}
                </span>
                <span className="text-xs text-stone-500">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {dirGroups.length > 0 && (
        <div className="rounded-lg border border-stone-800 p-4">
          <h3 className="text-xs font-medium text-stone-400 mb-3">
            Where changes are
          </h3>
          <div className="space-y-1.5">
            {dirGroups.map((group) => (
              <DirectoryBar
                key={group.dir}
                group={group}
                maxLines={maxDirLines}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
