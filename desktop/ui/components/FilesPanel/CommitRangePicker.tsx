import {
  type MouseEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { toast } from "sonner";
import { useReviewStore } from "../../stores";
import { openCommitView } from "./openCommit";
import {
  commitRangeFor,
  uncommittedRange,
  unpushedRange,
  sameRange,
  type CommitRange,
} from "../../types/commitRange";
import { truncateSubject } from "./commitFormat";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Spinner } from "../ui/spinner";
import { WarningIcon } from "../ui/icons";
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

/**
 * What slice of the branch the Review tab is showing.
 *
 * Nobody opening a branch asks "what is my merge-base?". They ask one of three
 * things — what is *in* this branch, what have I done since I last pushed, what
 * have I not committed — and the app could already answer all three, through
 * three unrelated controls with three vocabularies: a base override buried in a
 * menu you could only reach from a deleted-ref notice, an entry in this list,
 * and the default. So the base was a mechanism leaking out as though it were
 * the intent. Here they are three rows of one menu, named as the questions.
 *
 * All three are ordinary `CommitRange`s, including "unpushed": a selection
 * re-diffs — the range *is* the comparison — so changes a later commit
 * overwrote are visible inside the range that made them, and expressing the
 * unpushed slice as a base override instead would have made it the one row that
 * behaved differently. Ranges are offered from the branch's commit attribution,
 * which `setCommitRange` deliberately preserves across a narrowing so the full
 * list stays reachable.
 *
 * The trigger names the base it is diffing against, which nothing in the review
 * screen used to say — the base was visible only in the macOS window title.
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
  const localActivity = useReviewStore((s) => s.localActivity);
  const baseReason = useReviewStore((s) => s.baseReason);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const setBaseOverride = useReviewStore((s) => s.setBaseOverride);

  // Controlled so a row's "View" can close the menu itself: that button stops
  // the click before Radix sees it (otherwise the row would also narrow the
  // range), which takes the automatic dismissal with it.
  const [menuOpen, setMenuOpen] = useState(false);

  // What git already knows about the two branches this comparison spans: how
  // much of the head is unpublished, and how far the *base* has fallen behind
  // its own remote. Both ride along on the branch listing the sidebar loads, so
  // neither costs a call of its own.
  const { unpushed, baseBehind, defaultBranch } = useMemo(() => {
    const repo = localActivity.find((r) => r.repoPath === repoPath);
    const branch = (name: string | undefined) =>
      repo?.branches.find((b) => b.name === name);
    return {
      unpushed: branch(reviewComparison?.head)?.unpushedCommits ?? 0,
      baseBehind: branch(reviewComparison?.base)?.behindUpstream ?? 0,
      defaultBranch: repo?.defaultBranch ?? null,
    };
  }, [localActivity, repoPath, reviewComparison]);

  // A base someone pinned, which until now nothing in the review screen either
  // showed or could undo — the menu that clears it is reachable only from the
  // notice that says your ref was deleted. So a review pinned to a commit
  // months ago just quietly kept diffing against it.
  const pinned = baseReason === "override";

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

  /**
   * Drop a pinned base, which is what picking "whole branch" means when one is
   * set — the only row here whose slice lives in the review rather than in
   * `commitRange`.
   *
   * A refusal is reported rather than swallowed: the whole failure is that the
   * label doesn't change, which is indistinguishable from nothing having been
   * clicked. `ChangeBaseMenu` already surfaces the same failure this way.
   */
  const clearBase = async (repo: string, ref: string): Promise<void> => {
    const resolved = await setBaseOverride(repo, ref, null);
    if (!resolved) {
      toast.error(`Couldn't compare ${ref} against ${defaultBranch}`);
      return;
    }
    setCommitRange(null);
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
      <div className="flex items-center gap-1.5 border-b border-edge/60 px-3 py-1.5 text-xxs text-fg-faint">
        <Spinner className="h-3 w-3 border-2 border-edge-default border-t-status-modified" />
        Loading commits…
      </div>
    );
  }

  // Stated once, rather than paid for at every mention below: `attribution` is
  // only ever loaded against a comparison, so having commits at all implies
  // one. Without this the rest of the function reads as though the base might
  // be missing and renders `vs ` if it ever were.
  if (!attribution || !reviewComparison) return null;

  // Uncommitted work needs the review's head to actually be checked out —
  // either here, or in the linked worktree this review owns. Mirrors core's
  // `working_tree_dir`, which resolves the diff against both.
  const showUncommitted =
    reviewComparison.head === currentBranch || !!worktreePath;

  if (commits.length === 0 && !showUncommitted) return null;

  // Offered only when it is its own answer — see `unpushedRange`.
  const unpushedSlice = unpushedRange(commits, reviewComparison.base, unpushed);

  // What the review's *own* comparison is, named by the arm of the backend
  // ladder that produced it. This is what `BaseReason` was added for — "so the
  // UI can label the comparison honestly" — and it had never been read, which
  // is why one label had to cover four different comparisons and got at least
  // two of them wrong. The trunk case especially: the default branch against
  // itself is nothing but a working tree, and calling that "whole branch" is
  // the single most common review in the app describing itself as its
  // opposite.
  const wholeSlice = {
    override: { label: `Since ${reviewComparison.base}`, hint: "pinned" },
    trunkWorkingTree: { label: "Uncommitted", hint: reviewComparison.base },
    branchVsDefault: {
      label: "Whole branch",
      hint: `vs ${reviewComparison.base}`,
    },
    singleCommit: { label: "This commit", hint: reviewComparison.base },
  }[baseReason ?? "branchVsDefault"];

  // The trunk review *is* its working tree, so the uncommitted row would be
  // the row above it a second time, and "uncommitted work is included in the
  // whole branch" would be describing it as being inside itself.
  const uncommittedRow = showUncommitted && baseReason !== "trunkWorkingTree";
  // Every condition the pinned row itself renders under: counting it from
  // `pinned` alone let the two disagree, and a menu could reach the "nothing to
  // choose" case below with a chevron still on it.
  const unpinRow = pinned && !!defaultBranch && !!reviewRef && !!repoPath;

  // "All commits" named the *contents* and left out what they were being
  // compared against, which is the half nobody could see. The base is the
  // answer to "why is this list bigger than I expected".
  const label = commitRange
    ? truncateSubject(commitRange.title, 40)
    : [wholeSlice.label, wholeSlice.hint].filter(Boolean).join(" · ");

  // With one slice and no commits there is nothing to choose, and a menu whose
  // only row is the row you are already on is a control that lies about being
  // one. The trunk review is exactly this case — and it is the app's most
  // common screen, so it is worth getting right rather than leaving a chevron
  // that opens onto a single tick. It still has to *say* what it is showing:
  // being unable to see that is what sent us here.
  //
  // A stale base survives this collapse, though: it's the one thing a trunk
  // review can still be wrong about, and the warning below is the only place
  // that says so.
  if (
    !unpinRow &&
    !unpushedSlice &&
    !uncommittedRow &&
    baseBehind === 0 &&
    commits.length === 0
  ) {
    return (
      <div className="shrink-0 border-b border-edge/60 px-3 py-1.5 text-xs text-fg-muted">
        {label}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-edge/60">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-1.5 px-3 py-1.5 text-left text-xs
                       text-fg-muted hover:bg-fg/[0.04] hover:text-fg-secondary
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring/70"
            title="Which slice of the branch to review (shift-click commits to extend)"
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {CHEVRON_DOWN}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {/* The review's own comparison, named for what it actually is. */}
          <DropdownMenuItem onClick={() => select(null)}>
            <span className="flex-1">{wholeSlice.label}</span>
            <span className="shrink-0 text-xxs text-fg-faint">
              {wholeSlice.hint}
            </span>
            {!commitRange && SELECTED_CHECK}
          </DropdownMenuItem>

          {/* A pinned base is a slice like any other, so escaping it is picking
              a different one rather than a verb of its own. "Unpin" was a
              fourth vocabulary for the one idea this menu exists to unify —
              and it left the row above it reading "Whole branch · vs e14efa9",
              which is two claims that contradict each other.

              Clearing the override *is* what "whole branch" means, so the row
              that says so is the row that does it. */}
          {unpinRow && (
            <DropdownMenuItem
              onClick={() => void clearBase(repoPath!, reviewRef!)}
            >
              <span className="flex-1">Whole branch</span>
              <span className="shrink-0 text-xxs text-fg-faint">
                vs {defaultBranch}
              </span>
            </DropdownMenuItem>
          )}

          {unpushedSlice && (
            <DropdownMenuItem onClick={() => select(unpushedSlice)}>
              <span className="flex-1">Unpushed</span>
              <span className="shrink-0 text-xxs text-fg-faint tabular-nums">
                {unpushed} commits
              </span>
              {sameRange(unpushedSlice, commitRange) && SELECTED_CHECK}
            </DropdownMenuItem>
          )}

          {uncommittedRow && (
            <DropdownMenuItem
              onClick={() => select(uncommittedRange(reviewComparison.head))}
            >
              <span className="flex-1">Uncommitted</span>
              {commitRange?.kind === "uncommitted" && SELECTED_CHECK}
            </DropdownMenuItem>
          )}

          {/* The honest footnote on the whole-branch row: with the head branch
              checked out, core diffs against the working tree rather than the
              head commit, so uncommitted work is already inside every slice
              above except the ones bounded by two commits. Nothing said so, and
              it is half of why a review reads bigger than the branch is. */}
          {uncommittedRow && (
            <p className="px-2 pb-1 pt-0.5 text-xxs leading-4 text-fg-faint/70">
              Uncommitted work is included in {wholeSlice.label.toLowerCase()}.
            </p>
          )}

          {baseBehind > 0 && (
            <>
              <DropdownMenuSeparator />
              {/* Not a row you can act on — git is the only thing that can fix
                  it — but the one fact that explains a file list nobody
                  recognizes, and it is invisible from inside the diff. */}
              <p className="flex items-start gap-1.5 px-2 py-1 text-xxs leading-4 text-status-modified/90">
                <WarningIcon className="mt-px h-3 w-3 shrink-0" />
                <span>
                  <span className="tabular-nums">{baseBehind}</span> commits
                  behind on {reviewComparison?.base} — pull it to drop what
                  landed there from this diff.
                </span>
              </p>
            </>
          )}

          {commits.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2">
                <span className="flex-1">Commits</span>
                {/* Said up front, because the list below is the one part of
                    this menu whose length is the branch's business rather than
                    the app's — thirty-four of them is worth knowing before you
                    start scrolling. */}
                <span className="text-xxs font-normal text-fg-faint tabular-nums">
                  {commits.length}
                </span>
              </DropdownMenuLabel>
            </>
          )}
          {/* The commits scroll inside the menu rather than lengthening it.
              A branch's commit count is the branch's business — on a long one
              this list ran past the bottom of the window and took the three
              rows above it with it, so the slices, the warning and the whole
              point of the menu were off screen behind a scroll nobody could
              see the end of. Bounded here, they stay put and the list moves. */}
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
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
                  className={`group/commit ${selected ? "bg-focus-ring/10" : ""}`}
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
                  {/* The row's second verb. Clicking the row narrows the
                      review to this commit — a decision about what you are
                      reviewing; this just shows it, and persists nothing. */}
                  <button
                    type="button"
                    aria-label={`View commit ${c.shortHash}`}
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      void openCommitView(c.hash);
                    }}
                    className="shrink-0 rounded px-1 py-0.5 text-xxs font-medium text-fg-faint
                               opacity-0 hover:bg-fg/[0.08] hover:text-fg-secondary
                               focus-visible:opacity-100 group-hover/commit:opacity-100"
                  >
                    View
                  </button>
                  {selected && SELECTED_CHECK}
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
