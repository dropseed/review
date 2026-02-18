import { type ReactNode, useMemo, useState } from "react";
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

function getDiffLinePrefix(type: string): string {
  if (type === "added") return "+";
  if (type === "removed") return "-";
  return " ";
}

function getDiffLineColor(type: string): string {
  if (type === "added") return "text-diff-added/80";
  if (type === "removed") return "text-diff-removed/80";
  return "text-fg-muted";
}

function DiffPreview({ hunk }: { hunk: DiffHunk }): ReactNode {
  const lines = hunk.lines.slice(0, 6);
  const hasMore = hunk.lines.length > 6;

  return (
    <pre className="overflow-x-auto rounded bg-surface px-3 py-2 text-xxs leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={getDiffLineColor(line.type)}>
          {getDiffLinePrefix(line.type)} {line.content}
        </div>
      ))}
      {hasMore && (
        <div className="text-fg-faint mt-0.5">
          ... {hunk.lines.length - 6} more lines
        </div>
      )}
    </pre>
  );
}

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
}): ReactNode {
  return (
    <div className="rounded-lg border border-edge bg-surface-panel/50">
      {/* Header: file path + view in file */}
      <div className="flex items-center justify-between border-b border-edge/50 px-3 py-2">
        <button
          onClick={() => onSelectHunk(hunk.filePath, hunk.id)}
          className="truncate font-mono text-xs text-fg-secondary hover:text-status-renamed transition-colors text-left"
          title={hunk.id}
        >
          {hunk.filePath}
          <span className="text-fg-faint">
            :{hunk.id.split(":").pop()?.substring(0, 7)}
          </span>
        </button>
        <button
          onClick={() => onSelectHunk(hunk.filePath, hunk.id)}
          className="ml-3 flex-shrink-0 rounded px-2 py-0.5 text-xxs text-fg-muted hover:bg-surface-raised hover:text-fg-secondary transition-colors"
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
                      ? "bg-status-renamed/15 text-status-renamed"
                      : "bg-surface-hover/50 text-fg-muted"
                  }`}
                >
                  {lbl}
                </span>
              );
            })}
            {hunkState.classifiedVia === "static" && (
              <span className="rounded px-1.5 py-0.5 text-xxs font-medium bg-surface-raised text-fg-muted">
                Static
              </span>
            )}
            {hunkState.classifiedVia === "ai" && (
              <span className="rounded px-1.5 py-0.5 text-xxs font-medium bg-status-classifying/15 text-status-classifying">
                AI
              </span>
            )}
          </div>
        )}

        {/* Reasoning */}
        {hunkState?.reasoning && (
          <p className="text-xs italic text-fg-muted">{hunkState.reasoning}</p>
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
}: ClassificationsModalProps): ReactNode {
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

  function toggleCategory(category: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

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
            className="rounded p-1 text-fg-muted hover:bg-surface-raised hover:text-fg"
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
          <nav className="w-56 flex-shrink-0 overflow-y-auto border-r border-edge p-2">
            {/* All filter */}
            <button
              onClick={() => setSelectedFilter(null)}
              className={`mb-1 w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                selectedFilter === null
                  ? "bg-surface-raised text-fg-secondary"
                  : "text-fg-muted hover:bg-surface-raised/50 hover:text-fg-secondary"
              }`}
            >
              All
              <span className="ml-1 text-fg-muted">({hunks.length})</span>
            </button>

            {/* Category groups */}
            {groups.map((group) => {
              const isCollapsed = collapsedCategories.has(group.category);
              return (
                <div key={group.category} className="mb-0.5">
                  <button
                    onClick={() => toggleCategory(group.category)}
                    className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-raised/50 hover:text-fg-secondary transition-colors"
                  >
                    <svg
                      className={`h-3 w-3 flex-shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M9 6l6 6-6 6z" />
                    </svg>
                    <span>{group.category}</span>
                    <span className="ml-auto text-fg-faint">
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
                              ? "bg-surface-raised text-fg-secondary"
                              : "text-fg-muted hover:bg-surface-raised/50 hover:text-fg-secondary"
                          }`}
                        >
                          :{label.split(":").pop()}
                          <span className="ml-1 text-fg-faint">({count})</span>
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
                    ? "bg-surface-raised text-fg-secondary"
                    : "text-fg-muted hover:bg-surface-raised/50 hover:text-fg-secondary"
                }`}
              >
                Unclassified
                <span className="ml-1 text-fg-faint">
                  ({unclassifiedCount})
                </span>
              </button>
            )}
          </nav>

          {/* Right content: filtered hunk cards */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredHunks.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-fg-muted">
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
        <div className="flex justify-end border-t border-edge-default px-4 py-3">
          <button
            onClick={onClose}
            className="rounded bg-surface-hover px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-active"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
