import { useEffect, useMemo } from "react";
import type { MouseEvent } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import { effectiveHunkStatus, type CommitEntry } from "../../types";
import { UNCOMMITTED_COMMIT } from "../../types/hunkFilter";
import { CollapsibleSection } from "../ui/collapsible-section";
import { Spinner } from "../ui/spinner";
import { AVATAR_BASE_STYLE, emailToHue, getInitials } from "./CommitsPanel";

interface CommitAttributionSectionProps {
  isOpen: boolean;
  onToggle: () => void;
}

type SelectedRow =
  { kind: "commit"; commit: CommitEntry } | { kind: "uncommitted" };

/**
 * The commits of the current comparison as a navigation spine over the same
 * review: each row shows how much of its attributed hunks are reviewed, and
 * clicking one filters the file tree below to just that commit's hunks.
 * Attribution is derived from `base..head` on demand — review decisions stay
 * keyed on the net-diff hunks exactly as everywhere else in the app.
 *
 * A synthetic "Uncommitted changes" row is appended when any hunk has no
 * attribution at all, so those hunks stay reachable through the same
 * filter/selection UI as real commits instead of silently disappearing
 * whenever a commit filter is active.
 */
export function CommitAttributionSection({
  isOpen,
  onToggle,
}: CommitAttributionSectionProps) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const attribution = useReviewStore((s) => s.attribution);
  const attributionLoading = useReviewStore((s) => s.attributionLoading);
  const attributionLoaded = useReviewStore((s) => s.attributionLoaded);
  const loadAttribution = useReviewStore((s) => s.loadAttribution);
  const reviewFilter = useReviewStore((s) => s.reviewFilter);
  const setReviewFilter = useReviewStore((s) => s.setReviewFilter);
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useAllHunks();

  // Load lazily the first time this section renders for a comparison.
  useEffect(() => {
    if (repoPath && comparison && !attributionLoaded && !attributionLoading) {
      loadAttribution(repoPath, comparison.base, comparison.head);
    }
  }, [
    repoPath,
    comparison,
    attributionLoaded,
    attributionLoading,
    loadAttribution,
  ]);

  const selectedKeys = useMemo(
    () => new Set(reviewFilter.commits ?? []),
    [reviewFilter.commits],
  );

  const hasUncommittedHunks = useMemo(() => {
    if (!attribution) return false;
    return hunks.some((hunk) => !attribution.hunkCommits[hunk.id]?.length);
  }, [attribution, hunks]);

  // Row keys in display order: real commit hashes, then the synthetic
  // uncommitted row when present. Drives index-based shift-select and the
  // shared commitIndex lookup below — the uncommitted row participates in
  // selection exactly like a commit row, including range-select as the last
  // index.
  const rowKeys = useMemo(() => {
    const keys = attribution ? attribution.commits.map((c) => c.hash) : [];
    return hasUncommittedHunks ? [...keys, UNCOMMITTED_COMMIT] : keys;
  }, [attribution, hasUncommittedHunks]);

  const commitIndex = useMemo(() => {
    const map = new Map<string, number>();
    rowKeys.forEach((key, i) => map.set(key, i));
    return map;
  }, [rowKeys]);

  const commitByHash = useMemo(() => {
    const map = new Map<string, CommitEntry>();
    attribution?.commits.forEach((c) => map.set(c.hash, c));
    return map;
  }, [attribution]);

  // Selected rows, in list order (independent of click order) — used for the
  // range anchor and the multi-row context header below.
  const selectedRows = useMemo<SelectedRow[]>(
    () =>
      rowKeys
        .filter((key) => selectedKeys.has(key))
        .map((key) =>
          key === UNCOMMITTED_COMMIT
            ? { kind: "uncommitted" as const }
            : { kind: "commit" as const, commit: commitByHash.get(key)! },
        ),
    [rowKeys, selectedKeys, commitByHash],
  );

  const progressByCommit = useMemo(() => {
    const map = new Map<
      string,
      { total: number; done: number; shared: number }
    >();
    if (!attribution) return map;
    const trustList = reviewState?.trustList ?? [];
    for (const hunk of hunks) {
      const shas = attribution.hunkCommits[hunk.id];
      if (!shas || shas.length === 0) continue;
      const done =
        effectiveHunkStatus(reviewState?.hunks[hunk.id], trustList) !==
        "unreviewed";
      const shared = shas.length > 1;
      for (const sha of shas) {
        const entry = map.get(sha) ?? { total: 0, done: 0, shared: 0 };
        entry.total += 1;
        if (done) entry.done += 1;
        if (shared) entry.shared += 1;
        map.set(sha, entry);
      }
    }
    return map;
  }, [attribution, hunks, reviewState]);

  const uncommittedProgress = useMemo(() => {
    if (!attribution || !hasUncommittedHunks) return { total: 0, done: 0 };
    const trustList = reviewState?.trustList ?? [];
    let total = 0;
    let done = 0;
    for (const hunk of hunks) {
      if (attribution.hunkCommits[hunk.id]?.length) continue;
      total += 1;
      if (
        effectiveHunkStatus(reviewState?.hunks[hunk.id], trustList) !==
        "unreviewed"
      ) {
        done += 1;
      }
    }
    return { total, done };
  }, [attribution, hasUncommittedHunks, hunks, reviewState]);

  const selectRow = (key: string, e: MouseEvent) => {
    const current = reviewFilter.commits ?? [];

    if (e.shiftKey && current.length > 0) {
      const clickedIdx = commitIndex.get(key);
      if (clickedIdx == null) return;
      const selectedIndices = current
        .map((k) => commitIndex.get(k))
        .filter((i): i is number => i != null);
      if (selectedIndices.length === 0) {
        setReviewFilter({ ...reviewFilter, commits: [key] });
        return;
      }
      const nearestIdx = selectedIndices.reduce((best, i) =>
        Math.abs(i - clickedIdx) < Math.abs(best - clickedIdx) ? i : best,
      );
      const [lo, hi] =
        nearestIdx <= clickedIdx
          ? [nearestIdx, clickedIdx]
          : [clickedIdx, nearestIdx];
      setReviewFilter({ ...reviewFilter, commits: rowKeys.slice(lo, hi + 1) });
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      const next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
      setReviewFilter({
        ...reviewFilter,
        commits: next.length > 0 ? next : undefined,
      });
      return;
    }

    // Plain click: select only this row; clicking the sole selection clears it.
    const isOnlySelected = current.length === 1 && current[0] === key;
    setReviewFilter({
      ...reviewFilter,
      commits: isOnlySelected ? undefined : [key],
    });
  };

  if (!comparison) return null;

  if (attributionLoading && !attribution) {
    return (
      <div className="flex items-center gap-2 border-t border-t-edge/40 px-3 py-2 text-xs text-fg-muted">
        <Spinner className="h-3.5 w-3.5 border-2 border-edge-default border-t-status-modified" />
        Attributing hunks to commits…
      </div>
    );
  }

  if (!attribution || attribution.commits.length === 0) return null;

  return (
    <>
      <CollapsibleSection
        title="Commits"
        badge={attribution.commits.length}
        isOpen={isOpen}
        onToggle={onToggle}
      >
        <div className="py-1">
          {attribution.commits.map((commit) => {
            const progress = progressByCommit.get(commit.hash) ?? {
              total: 0,
              done: 0,
              shared: 0,
            };
            const isSelected = selectedKeys.has(commit.hash);
            const isComplete =
              progress.total > 0 && progress.done === progress.total;
            return (
              <button
                key={commit.hash}
                type="button"
                onClick={(e) => selectRow(commit.hash, e)}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left transition-colors duration-75 ${
                  isSelected ? "bg-focus-ring/10" : "hover:bg-surface-raised/40"
                }`}
              >
                <span
                  className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-white"
                  style={{
                    ...AVATAR_BASE_STYLE,
                    backgroundColor: `hsl(${emailToHue(commit.authorEmail)}, 45%, 55%)`,
                  }}
                  title={`${commit.author} <${commit.authorEmail}>`}
                >
                  {getInitials(commit.author)}
                </span>
                <span
                  className={`shrink-0 font-mono text-xxs ${
                    isSelected ? "text-focus-ring" : "text-fg-muted"
                  }`}
                >
                  {commit.shortHash}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">
                  {commit.message}
                </span>
                {progress.shared > 0 && (
                  <span
                    className="shrink-0 text-xxs text-fg-faint/70"
                    title={`${progress.shared} of ${progress.total} hunks shared with other commits`}
                  >
                    ⧉
                  </span>
                )}
                <span
                  className={`shrink-0 text-xxs tabular-nums ${
                    isComplete ? "text-status-approved" : "text-fg-faint"
                  }`}
                >
                  {progress.done}/{progress.total}
                </span>
              </button>
            );
          })}

          {hasUncommittedHunks && (
            <button
              type="button"
              onClick={(e) => selectRow(UNCOMMITTED_COMMIT, e)}
              aria-pressed={selectedKeys.has(UNCOMMITTED_COMMIT)}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left transition-colors duration-75 ${
                selectedKeys.has(UNCOMMITTED_COMMIT)
                  ? "bg-focus-ring/10"
                  : "hover:bg-surface-raised/40"
              }`}
            >
              <span
                className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-fg-faint"
                style={AVATAR_BASE_STYLE}
                title="Not yet part of any commit"
              >
                •
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-xs italic ${
                  selectedKeys.has(UNCOMMITTED_COMMIT)
                    ? "text-focus-ring"
                    : "text-fg-muted"
                }`}
              >
                Uncommitted changes
              </span>
              <span
                className={`shrink-0 text-xxs tabular-nums ${
                  uncommittedProgress.total > 0 &&
                  uncommittedProgress.done === uncommittedProgress.total
                    ? "text-status-approved"
                    : "text-fg-faint"
                }`}
              >
                {uncommittedProgress.done}/{uncommittedProgress.total}
              </span>
            </button>
          )}
        </div>
      </CollapsibleSection>

      {selectedRows.length > 0 && (
        <div className="border-b border-t border-edge-default/40 bg-surface-raised/40 px-3 py-2">
          {selectedRows.length === 1 ? (
            selectedRows[0].kind === "uncommitted" ? (
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-fg-secondary">
                  Uncommitted changes — not yet part of any commit.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-xxs text-fg-muted">
                    {selectedRows[0].commit.shortHash}
                  </span>
                  <span className="text-xs font-medium text-fg-secondary">
                    {selectedRows[0].commit.message}
                  </span>
                </div>
                {selectedRows[0].commit.body && (
                  <div className="max-h-40 overflow-y-auto whitespace-pre-line text-xxs text-fg-muted scrollbar-thin">
                    {selectedRows[0].commit.body}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="flex flex-col gap-0.5">
              {selectedRows.map((row) =>
                row.kind === "uncommitted" ? (
                  <div
                    key={UNCOMMITTED_COMMIT}
                    className="flex items-baseline gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-medium italic text-fg-secondary">
                      Uncommitted changes
                    </span>
                  </div>
                ) : (
                  <div
                    key={row.commit.hash}
                    className="flex items-baseline gap-2"
                  >
                    <span className="shrink-0 font-mono text-xxs text-fg-muted">
                      {row.commit.shortHash}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-secondary">
                      {row.commit.message}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
