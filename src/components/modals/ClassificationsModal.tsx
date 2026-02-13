import { useMemo, useState } from "react";
import { useReviewStore } from "../../stores";
import { isHunkUnclassified, type DiffHunk, type HunkState } from "../../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";

interface ClassificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectHunk: (filePath: string, hunkId: string) => void;
}

interface LabelGroup {
  category: string;
  labels: { label: string; count: number }[];
  totalCount: number;
}

/** Build grouped label data from hunks and their states */
function buildLabelGroups(
  hunks: DiffHunk[],
  reviewState: { hunks: Record<string, HunkState> } | null,
): { groups: LabelGroup[]; unclassifiedCount: number } {
  const labelCounts = new Map<string, number>();
  let unclassifiedCount = 0;

  for (const hunk of hunks) {
    const state = reviewState?.hunks[hunk.id];
    if (state?.label && state.label.length > 0) {
      for (const lbl of state.label) {
        labelCounts.set(lbl, (labelCounts.get(lbl) || 0) + 1);
      }
    } else if (isHunkUnclassified(state)) {
      unclassifiedCount++;
    }
  }

  // Group by category (part before the colon)
  const categoryMap = new Map<string, { label: string; count: number }[]>();
  for (const [label, count] of labelCounts) {
    const colonIdx = label.indexOf(":");
    const category = colonIdx >= 0 ? label.substring(0, colonIdx) : label;
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category)!.push({ label, count });
  }

  // Sort categories alphabetically, labels alphabetically within
  const groups: LabelGroup[] = [];
  for (const category of [...categoryMap.keys()].sort()) {
    const labels = categoryMap
      .get(category)!
      .sort((a, b) => a.label.localeCompare(b.label));
    groups.push({
      category,
      labels,
      totalCount: labels.reduce((sum, l) => sum + l.count, 0),
    });
  }

  return { groups, unclassifiedCount };
}

/** Get hunks matching a filter */
function getFilteredHunks(
  hunks: DiffHunk[],
  reviewState: { hunks: Record<string, HunkState> } | null,
  filter: string | null,
): DiffHunk[] {
  if (filter === null) return hunks;

  if (filter === "__unclassified__") {
    return hunks.filter((h) => isHunkUnclassified(reviewState?.hunks[h.id]));
  }

  return hunks.filter((h) => {
    const state = reviewState?.hunks[h.id];
    return state?.label?.includes(filter);
  });
}

/** Render diff lines with +/- coloring */
function DiffPreview({ hunk }: { hunk: DiffHunk }) {
  const lines = hunk.lines.slice(0, 6);
  const hasMore = hunk.lines.length > 6;

  return (
    <pre className="overflow-x-auto rounded bg-stone-950 px-3 py-2 text-xxs leading-relaxed">
      {lines.map((line, i) => {
        let colorClass = "text-stone-500";
        if (line.type === "added") colorClass = "text-emerald-400/80";
        if (line.type === "removed") colorClass = "text-rose-400/80";
        const prefix =
          line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
        return (
          <div key={i} className={colorClass}>
            {prefix} {line.content}
          </div>
        );
      })}
      {hasMore && (
        <div className="text-stone-600 mt-0.5">
          ... {hunk.lines.length - 6} more lines
        </div>
      )}
    </pre>
  );
}

/** A single hunk card in the right content area */
function HunkCard({
  hunk,
  hunkState,
  trustList,
  onSelectHunk,
}: {
  hunk: DiffHunk;
  hunkState: HunkState | undefined;
  trustList: string[];
  onSelectHunk: (filePath: string, hunkId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/50">
      {/* Header: file path + view in file */}
      <div className="flex items-center justify-between border-b border-stone-800/50 px-3 py-2">
        <button
          onClick={() => onSelectHunk(hunk.filePath, hunk.id)}
          className="truncate font-mono text-xs text-stone-300 hover:text-sky-400 transition-colors text-left"
          title={hunk.id}
        >
          {hunk.filePath}
          <span className="text-stone-600">
            :{hunk.id.split(":").pop()?.substring(0, 7)}
          </span>
        </button>
        <button
          onClick={() => onSelectHunk(hunk.filePath, hunk.id)}
          className="ml-3 flex-shrink-0 rounded px-2 py-0.5 text-xxs text-stone-500 hover:bg-stone-800 hover:text-stone-300 transition-colors"
        >
          View in file
        </button>
      </div>

      {/* Body: labels, reasoning, diff preview */}
      <div className="px-3 py-2 space-y-2">
        {/* Labels */}
        {hunkState?.label && hunkState.label.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {hunkState.label.map((lbl, i) => {
              const isTrusted = trustList.includes(lbl);
              return (
                <span
                  key={i}
                  className={`rounded px-1.5 py-0.5 text-xxs font-medium ${
                    isTrusted
                      ? "bg-sky-500/15 text-sky-400"
                      : "bg-stone-700/50 text-stone-400"
                  }`}
                >
                  {lbl}
                </span>
              );
            })}
            {hunkState.classifiedVia === "static" && (
              <span className="rounded px-1.5 py-0.5 text-xxs font-medium bg-stone-800 text-stone-500">
                Static
              </span>
            )}
            {hunkState.classifiedVia === "ai" && (
              <span className="rounded px-1.5 py-0.5 text-xxs font-medium bg-violet-500/15 text-violet-400">
                AI
              </span>
            )}
          </div>
        )}

        {/* Reasoning */}
        {hunkState?.reasoning && (
          <p className="text-xs italic text-stone-400">{hunkState.reasoning}</p>
        )}

        {/* Diff preview */}
        <DiffPreview hunk={hunk} />
      </div>
    </div>
  );
}

export function ClassificationsModal({
  isOpen,
  onClose,
  onSelectHunk,
}: ClassificationsModalProps) {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const trustList = reviewState?.trustList ?? [];

  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );

  const { groups, unclassifiedCount } = useMemo(
    () => buildLabelGroups(hunks, reviewState),
    [hunks, reviewState],
  );

  const classifiedCount = useMemo(() => {
    return hunks.filter((h) => {
      const state = reviewState?.hunks[h.id];
      return state?.label && state.label.length > 0;
    }).length;
  }, [hunks, reviewState]);

  const filteredHunks = useMemo(
    () => getFilteredHunks(hunks, reviewState, selectedFilter),
    [hunks, reviewState, selectedFilter],
  );

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] w-[90vw] max-w-7xl flex-col rounded-lg overflow-hidden">
        <DialogHeader>
          <div>
            <DialogTitle className="text-sm font-medium">
              Classifications
            </DialogTitle>
            <DialogDescription>
              {classifiedCount} classified &middot; {unclassifiedCount}{" "}
              unclassified
            </DialogDescription>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </DialogHeader>

        {/* Main content: sidebar + hunk list */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar: label groups */}
          <nav className="w-56 flex-shrink-0 overflow-y-auto border-r border-stone-800 p-2">
            {/* All filter */}
            <button
              onClick={() => setSelectedFilter(null)}
              className={`mb-1 w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                selectedFilter === null
                  ? "bg-stone-800 text-stone-200"
                  : "text-stone-400 hover:bg-stone-800/50 hover:text-stone-300"
              }`}
            >
              All
              <span className="ml-1 text-stone-500">({hunks.length})</span>
            </button>

            {/* Category groups */}
            {groups.map((group) => {
              const isCollapsed = collapsedCategories.has(group.category);
              return (
                <div key={group.category} className="mb-0.5">
                  <button
                    onClick={() => toggleCategory(group.category)}
                    className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-stone-400 hover:bg-stone-800/50 hover:text-stone-300 transition-colors"
                  >
                    <svg
                      className={`h-3 w-3 flex-shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M9 6l6 6-6 6z" />
                    </svg>
                    <span>{group.category}</span>
                    <span className="ml-auto text-stone-600">
                      ({group.totalCount})
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="ml-3">
                      {group.labels.map(({ label, count }) => (
                        <button
                          key={label}
                          onClick={() => setSelectedFilter(label)}
                          className={`w-full rounded px-2 py-1 text-left text-xs transition-colors ${
                            selectedFilter === label
                              ? "bg-stone-800 text-stone-200"
                              : "text-stone-500 hover:bg-stone-800/50 hover:text-stone-300"
                          }`}
                        >
                          :{label.split(":").pop()}
                          <span className="ml-1 text-stone-600">({count})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unclassified */}
            {unclassifiedCount > 0 && (
              <button
                onClick={() => setSelectedFilter("__unclassified__")}
                className={`mt-1 w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  selectedFilter === "__unclassified__"
                    ? "bg-stone-800 text-stone-200"
                    : "text-stone-500 hover:bg-stone-800/50 hover:text-stone-300"
                }`}
              >
                Unclassified
                <span className="ml-1 text-stone-600">
                  ({unclassifiedCount})
                </span>
              </button>
            )}
          </nav>

          {/* Right content: filtered hunk cards */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredHunks.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-stone-500">
                  {hunks.length === 0
                    ? "No hunks to display"
                    : "No hunks match this filter"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHunks.map((hunk) => (
                  <HunkCard
                    key={hunk.id}
                    hunk={hunk}
                    hunkState={reviewState?.hunks[hunk.id]}
                    trustList={trustList}
                    onSelectHunk={onSelectHunk}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-stone-700 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded bg-stone-700 px-3 py-1.5 text-xs font-medium text-stone-100 hover:bg-stone-600"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
