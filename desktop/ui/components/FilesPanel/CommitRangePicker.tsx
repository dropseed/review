import { type MouseEvent, type ReactNode, useRef, useEffect } from "react";
import { useReviewStore } from "../../stores";
import {
  commitRangeFor,
  uncommittedRange,
  sameRange,
  type CommitRange,
} from "../../types/commitRange";
import { truncateSubject } from "./commitFormat";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Spinner } from "../ui/spinner";
import { SELECTED_CHECK } from "./PanelToolbar";

const CHEVRON_DOWN = (
  <svg
    className="h-3 w-3 shrink-0 text-fg-faint"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const COMMITS_ICON = (
  <svg
    className="h-3.5 w-3.5 shrink-0 text-fg-faint"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v6M12 15v6" />
  </svg>
);

/**
 * The Review tab's commit range picker: narrows the review to one commit, a
 * contiguous shift-click range, or the uncommitted bucket. Unlike the hunk
 * filter it replaced, a selection re-diffs — the range *is* the comparison —
 * so changes a later commit overwrote are visible inside the range that made
 * them. Ranges are offered from the branch's commit attribution, which
 * `setCommitRange` deliberately preserves across a narrowing so the full list
 * stays reachable.
 */
export function CommitRangePicker(): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewComparison = useReviewStore((s) => s.reviewComparison);
  const commitRange = useReviewStore((s) => s.commitRange);
  const setCommitRange = useReviewStore((s) => s.setCommitRange);
  const currentBranch = useReviewStore((s) => s.currentBranch);
  const worktreePath = useReviewStore((s) => s.worktreePath);
  const attribution = useReviewStore((s) => s.attribution);
  const attributionLoading = useReviewStore((s) => s.attributionLoading);
  const attributionLoaded = useReviewStore((s) => s.attributionLoaded);
  const loadAttribution = useReviewStore((s) => s.loadAttribution);

  // Always attributed against the *review* comparison, never the active range —
  // otherwise narrowing would shrink the list you narrow from.
  useEffect(() => {
    if (
      repoPath &&
      reviewComparison &&
      !attributionLoaded &&
      !attributionLoading
    ) {
      loadAttribution(repoPath, reviewComparison.base, reviewComparison.head);
    }
  }, [
    repoPath,
    reviewComparison,
    attributionLoaded,
    attributionLoading,
    loadAttribution,
  ]);

  const commits = attribution?.commits ?? [];

  // Shift-click extends from the active range's lower end — derived rather
  // than held in state, so it can't drift from what's actually selected.
  const anchorOrdinal =
    commitRange?.kind === "commits" ? commitRange.loOrdinal : null;

  // Which modifier the click about to fire onSelect carried — set in onClick (a
  // real MouseEvent), read in onSelect (a synthetic CustomEvent with no
  // modifier keys), so a shift-click can preventDefault() and keep the menu open.
  const shiftRef = useRef(false);

  // One selection policy for every row: picking what's already active clears it.
  const select = (range: CommitRange | null): void => {
    setCommitRange(sameRange(range, commitRange) ? null : range);
  };

  const handleCommitClick = (ordinal: number): void => {
    if (!reviewComparison) return;
    const [lo, hi] =
      shiftRef.current && anchorOrdinal != null
        ? [Math.min(anchorOrdinal, ordinal), Math.max(anchorOrdinal, ordinal)]
        : [ordinal, ordinal];
    select(commitRangeFor(commits, reviewComparison.base, lo, hi));
  };

  if (attributionLoading && !attribution) {
    return (
      <div className="flex items-center gap-1.5 border-b border-edge-default/40 px-2 py-1.5 text-xxs text-fg-faint">
        <Spinner className="h-3 w-3 border-2 border-edge-default border-t-status-modified" />
        Loading commits…
      </div>
    );
  }

  // Uncommitted work needs the review's head to actually be checked out —
  // either here, or in the linked worktree this review owns. Mirrors core's
  // `working_tree_dir`, which resolves the diff against both.
  const showUncommitted =
    !!reviewComparison &&
    (reviewComparison.head === currentBranch || !!worktreePath);

  if (!attribution || (commits.length === 0 && !showUncommitted)) return null;

  const label = commitRange
    ? truncateSubject(commitRange.title, 40)
    : "All commits";

  return (
    <div className="border-b border-edge-default/40 px-2 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-fg-secondary hover:bg-surface-raised/60"
            title="Narrow the review to a commit or range (shift-click to extend)"
          >
            {COMMITS_ICON}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {CHEVRON_DOWN}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuItem onClick={() => select(null)}>
            <span className="flex-1">All commits</span>
            {!commitRange && SELECTED_CHECK}
          </DropdownMenuItem>
          {commits.length > 0 && <DropdownMenuSeparator />}
          {commits.map((c, i) => {
            const ordinal = i + 1;
            const selected =
              commitRange?.kind === "commits" &&
              ordinal >= commitRange.loOrdinal &&
              ordinal <= commitRange.hiOrdinal;
            return (
              <DropdownMenuItem
                key={c.hash}
                onClick={(e: MouseEvent) => {
                  shiftRef.current = e.shiftKey;
                  handleCommitClick(ordinal);
                }}
                onSelect={(e: Event) => {
                  if (shiftRef.current) e.preventDefault();
                }}
                className={selected ? "bg-focus-ring/10" : undefined}
              >
                <span className="w-6 shrink-0 text-right font-mono text-xxs text-fg-faint">
                  #{ordinal}
                </span>
                <span className="shrink-0 font-mono text-xxs text-fg-muted">
                  {c.shortHash}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {truncateSubject(c.message, 40)}
                </span>
                {selected && SELECTED_CHECK}
              </DropdownMenuItem>
            );
          })}
          {showUncommitted && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => select(uncommittedRange(reviewComparison.head))}
              >
                <span className="flex-1 italic text-fg-muted">
                  Uncommitted changes
                </span>
                {commitRange?.kind === "uncommitted" && SELECTED_CHECK}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
