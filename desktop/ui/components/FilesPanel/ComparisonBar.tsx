import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { getApiClient } from "../../api";
import { useReviewStore } from "../../stores";
import { isCheckedOut } from "../../stores/selectors/checkout";
import type { BaseReason, CommitEntry } from "../../types";
import {
  commitRangeFor,
  commitRangeForSha,
  sameRange,
  uncommittedRange,
  unpushedRange,
  type CommitRange,
} from "../../types/commitRange";
import { REVIEW_VIEWPOINT } from "../../types/viewpoint";
import { formatAge } from "../../utils/format-age";
import { truncateSubject } from "./commitFormat";
import { openCommitView } from "./openCommit";
import { refLabel } from "./refLabel";
import { ChangeBaseMenu } from "../Sidebar/ChangeBaseMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { SimpleTooltip } from "../ui/tooltip";
import { ChevronDownIcon, WarningIcon } from "../ui/icons";
import { SELECTED_CHECK } from "./PanelToolbar";

interface WholeSlice {
  /** What the review's own comparison is, in the words of the intent behind it. */
  label: string;
  /** What it is measured against, said quietly beside the label. */
  hint: string;
  /** The same intent as a clause, for the bar's "vs X · … · N commits" line. */
  descriptor: string;
  /**
   * How the label reads mid-sentence, where lowercasing it isn't enough — an
   * acronym is not a word, and "included in whole pr" is not a sentence.
   */
  inline?: string;
}

/**
 * The review's *own* comparison, named by the arm of the backend ladder that
 * produced it. This is what `BaseReason` was added for — "so the UI can label
 * the comparison honestly" — and it had never been read, which is why one label
 * had to cover four different comparisons and got at least two of them wrong.
 * The trunk case especially: the default branch against itself is nothing but a
 * working tree, and calling that "whole branch" is the single most common
 * review in the app describing itself as its opposite.
 *
 * Total over `BaseReason`, in both directions, because this is a wire value:
 *
 * - The `Record` makes a new arm on the backend a *compile* error here the
 *   moment it lands in the union, rather than a row nobody wrote.
 * - The `??` covers the other direction — an app meeting a daemon newer than
 *   itself. `pullRequest` arrived that way and this lookup returned
 *   `undefined`, so opening a PR from the sidebar didn't mislabel one line, it
 *   took the whole window down. A wrong-but-derived label is a bug; a crash on
 *   a string nobody has taught the UI yet is a category error.
 */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function wholeSliceFor(
  baseReason: BaseReason | null,
  base: string,
  commitCount: number,
): WholeSlice {
  const slices: Record<BaseReason, WholeSlice> = {
    override: {
      label: `Since ${base}`,
      // The commit count is the label's answer to "why is this review so
      // big": a pin outlives the moment it was set and keeps accumulating,
      // and "pinned" alone gave no hint of how far it had drifted.
      hint:
        commitCount > 0
          ? `pinned · ${plural(commitCount, "commit")}`
          : "pinned",
      descriptor: "pinned",
    },
    // A PR is reviewed at its fetched head (`refs/review/pr/N`) against the
    // base branch GitHub says it targets — not against this repo's default,
    // which is what "whole branch" would be claiming on a PR into a release
    // branch.
    pullRequest: {
      label: "Whole PR",
      hint: `vs ${base}`,
      descriptor: "whole PR",
      inline: "the whole PR",
    },
    trunkWorkingTree: {
      label: "Uncommitted",
      hint: base,
      descriptor: "uncommitted",
    },
    branchVsDefault: {
      label: "Whole branch",
      hint: `vs ${base}`,
      descriptor: "whole branch",
    },
    singleCommit: {
      label: "This commit",
      hint: base,
      descriptor: "this commit",
    },
  };
  return slices[baseReason as BaseReason] ?? slices.branchVsDefault;
}

/** One comparison the menu offers, drawn with both of its ends. */
function MenuRow({
  label,
  hint,
  selected = false,
  onClick,
  onSelect,
}: {
  label: ReactNode;
  hint?: ReactNode;
  selected?: boolean;
  onClick?: (e: MouseEvent) => void;
  onSelect?: (e: Event) => void;
}): ReactNode {
  return (
    <DropdownMenuItem
      onClick={onClick}
      onSelect={onSelect}
      className={selected ? "bg-focus-ring/10" : ""}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span className="shrink-0 text-xxs text-fg-faint tabular-nums">
          {hint}
        </span>
      )}
      {selected && SELECTED_CHECK}
    </DropdownMenuItem>
  );
}

/** A commit row: hash, subject, age — the three things that identify one. */
function CommitRow({
  commit,
  selected,
  onClick,
  onSelect,
}: {
  commit: CommitEntry;
  selected: boolean;
  onClick: (e: MouseEvent) => void;
  onSelect?: (e: Event) => void;
}): ReactNode {
  return (
    <MenuRow
      selected={selected}
      onClick={onClick}
      onSelect={onSelect}
      label={
        <>
          <span className="mr-1.5 font-mono text-xxs text-fg-faint">
            {commit.shortHash}
          </span>
          {truncateSubject(commit.message, 40)}
        </>
      }
      hint={commit.date ? formatAge(commit.date) : undefined}
    />
  );
}

/** How far back "History" reaches. A way in to a commit, not a place to read. */
const HISTORY_LIMIT = 20;

interface HistoryState {
  entries: CommitEntry[];
  loading: boolean;
  error: string | null;
}

const NO_HISTORY: HistoryState = { entries: [], loading: false, error: null };

const NO_COMMITS: CommitEntry[] = [];

/**
 * What the code half is looking at, and every other thing it could look at.
 *
 * Two lines, two ends: the head in the app's own words on top, what it is being
 * measured against underneath. Nobody opening a branch asks "what is my
 * merge-base?" — they ask what is *in* this branch, what they have done since
 * they last pushed, what they have not committed, or what one commit did. The
 * app could already answer all of those, through four unrelated controls with
 * four vocabularies: a base override reachable only from a deleted-ref notice,
 * a range picker inside the file list, a commit log at the bottom of Browse,
 * and a banner above the diff. Every one of them named a `base..head`, so they
 * are one control: the bar says which pair is on screen, and its menu is the
 * list of pairs, each row showing both of its ends.
 *
 * Tinted whenever the head isn't a revision that is checked out, because that
 * is the one fact that changes what can be done here — staging, comments and
 * the Git tab all belong to a working tree.
 */
export function ComparisonBar(): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewComparison = useReviewStore((s) => s.reviewComparison);
  const viewpoint = useReviewStore((s) => s.viewpoint);
  const setViewpoint = useReviewStore((s) => s.setViewpoint);
  const checkedOut = useReviewStore((s) => isCheckedOut(s, s.comparison));
  // Uncommitted work needs the *review's* head to actually be checked out,
  // deliberately rather than whatever slice is on screen: offering it is about
  // the branch the review is of.
  const showUncommitted = useReviewStore((s) =>
    isCheckedOut(s, s.reviewComparison),
  );
  const attribution = useReviewStore((s) => s.attribution);
  const attributionLoading = useReviewStore((s) => s.attributionLoading);
  const attributionLoaded = useReviewStore((s) => s.attributionLoaded);
  const loadAttribution = useReviewStore((s) => s.loadAttribution);
  // Identity-stable per the slice, so the branch lookups below are rebuilt when
  // this repo's activity changes rather than when any repo's does.
  const repoActivity = useReviewStore((s) =>
    s.localActivity.find((r) => r.repoPath === s.repoPath),
  );
  const baseReason = useReviewStore((s) => s.baseReason);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const setBaseOverride = useReviewStore((s) => s.setBaseOverride);

  // Controlled so the rows that are *not* a choice of comparison — expanding
  // History, extending a range with shift — can keep the menu open.
  const [menuOpen, setMenuOpen] = useState(false);
  const [changeBaseOpen, setChangeBaseOpen] = useState(false);
  // History is the way to a commit this branch doesn't contain. A branch with
  // commits of its own already lists them above, so the older ones wait behind
  // a row; with none — a trunk review — history is the only list there is.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY);

  // What git already knows about the two branches this comparison spans: how
  // much of the head is unpublished, and how far the *base* has fallen behind
  // its own remote. Both ride along on the branch listing the sidebar loads, so
  // neither costs a call of its own.
  const { unpushed, baseBehind, defaultBranch } = useMemo(() => {
    const branch = (name: string | undefined) =>
      repoActivity?.branches.find((b) => b.name === name);
    return {
      unpushed: branch(reviewComparison?.head)?.unpushedCommits ?? 0,
      baseBehind: branch(reviewComparison?.base)?.behindUpstream ?? 0,
      defaultBranch: repoActivity?.defaultBranch ?? null,
    };
  }, [repoActivity, reviewComparison]);

  // Always attributed against the *review* comparison, never the active range —
  // otherwise narrowing would shrink the list you narrow from.
  //
  // Deferred a macrotask past mount: attribution blames every changed file and
  // on a large comparison can run for seconds, occupying one of the browser's
  // few connections to the backend for the whole call. Firing it in the same
  // tick as the initial load would race it against get-all-hunks and friends
  // for those connections and make the diff itself wait behind it. A
  // `setTimeout` queues this after every effect from the same mount has
  // already issued its own fetch, so the hunks the user is here to see win
  // the race; this only changes *when* the request goes out, not whether.
  useEffect(() => {
    if (
      !repoPath ||
      !reviewComparison ||
      attributionLoaded ||
      attributionLoading
    ) {
      return;
    }
    const timer = setTimeout(() => {
      loadAttribution(repoPath, reviewComparison.base, reviewComparison.head);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    repoPath,
    reviewComparison,
    attributionLoaded,
    attributionLoading,
    loadAttribution,
  ]);

  // Fetched only once the group is actually unfolded: this is a `git log` for
  // a list most visits never open. Keyed on the ref rather than on the menu
  // being open, because `historyOpen` is sticky — every reopen of the menu
  // would otherwise run the log again for the commits already on screen.
  const historyRef = reviewComparison?.head ?? null;
  const loadedHistoryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!historyOpen || !repoPath || !historyRef) return;
    if (loadedHistoryRef.current === historyRef) return;
    loadedHistoryRef.current = historyRef;
    let cancelled = false;
    setHistory({ ...NO_HISTORY, loading: true });
    getApiClient()
      .listCommits(repoPath, HISTORY_LIMIT, historyRef)
      .then((entries) => {
        if (!cancelled) setHistory({ entries, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to list commits:", err);
        setHistory({ ...NO_HISTORY, error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [historyOpen, repoPath, historyRef]);

  // A stable empty list when there is no attribution yet, so the two memos
  // below aren't rebuilt on every render by a fresh `[]`.
  const commits = attribution?.commits ?? NO_COMMITS;
  const range = viewpoint.kind === "range" ? viewpoint.range : null;
  const peek = viewpoint.kind === "commit" ? viewpoint.view : null;

  // The branch's commits read like a log — newest first — while the ordinals a
  // range is expressed in count from the oldest. Paired here so the two never
  // have to be reconciled at a call site.
  const log = useMemo(
    () => commits.map((c, i) => ({ commit: c, ordinal: i + 1 })).reverse(),
    [commits],
  );
  const inBranch = useMemo(
    () => new Set(commits.map((c) => c.hash)),
    [commits],
  );

  // Shift-click extends from the active range's lower end — derived rather
  // than held in state, so it can't drift from what's actually selected.
  const anchorOrdinal = range?.kind === "commits" ? range.loOrdinal : null;

  // Which modifier the click about to fire onSelect carried — set in onClick (a
  // real MouseEvent), read in onSelect (a synthetic CustomEvent with no
  // modifier keys), so a shift-click can preventDefault() and keep the menu open.
  const shiftRef = useRef(false);

  // Set by the "Change base…" row, read by the menu's close handler — see it
  // for why the popover cannot be opened from the row itself.
  const changeBasePending = useRef(false);

  // One selection policy for every row: picking what's already active clears it.
  const select = (picked: CommitRange | null): void => {
    setViewpoint(
      picked && !sameRange(picked, range)
        ? { kind: "range", range: picked }
        : REVIEW_VIEWPOINT,
    );
  };

  /**
   * Drop a pinned base, which is what picking the derived slice means when one
   * is set — the only row here whose slice lives in the review rather than in
   * the viewpoint.
   *
   * A refusal is reported rather than swallowed: the whole failure is that the
   * label doesn't change, which is indistinguishable from nothing having been
   * clicked. `ChangeBaseMenu` already surfaces the same failure this way.
   */
  const clearBase = async (repo: string, ref: string): Promise<void> => {
    const resolved = await setBaseOverride(repo, ref, null);
    if (!resolved) {
      toast.error(`Couldn't clear the pinned base of ${ref}`);
      return;
    }
    setViewpoint(REVIEW_VIEWPOINT);
  };

  const handleCommitClick = (ordinal: number): void => {
    if (!reviewComparison) return;
    const [lo, hi] =
      shiftRef.current && anchorOrdinal != null
        ? [Math.min(anchorOrdinal, ordinal), Math.max(anchorOrdinal, ordinal)]
        : [ordinal, ordinal];
    select(commitRangeFor(commits, reviewComparison.base, lo, hi));
  };

  /**
   * A commit reaches the screen by one rule wherever it was clicked: one this
   * branch contains narrows the review to it — a decision about what is being
   * reviewed — and one it doesn't is a peek, which persists nothing. Two lists
   * behaving differently on the same commit is what made "View" a separate
   * button on every row.
   */
  const openCommit = (hash: string): void => {
    if (reviewComparison && inBranch.has(hash)) {
      select(commitRangeForSha(commits, reviewComparison.base, hash));
      return;
    }
    void openCommitView(hash);
  };

  // Nothing to compare: browse-only mode has no bar, because there is no pair
  // to name and nothing the menu could offer instead.
  if (!reviewComparison) return null;

  // Offered only when it is its own answer — see `unpushedRange`.
  const unpushedSlice = unpushedRange(commits, reviewComparison.base, unpushed);

  // What the review's *own* comparison is, named by the arm of the backend
  // ladder that produced it. See `wholeSliceFor`.
  const wholeSlice = wholeSliceFor(
    baseReason,
    reviewComparison.base,
    commits.length,
  );

  // A base someone pinned, which until now nothing in the review screen either
  // showed or could undo — the menu that clears it was reachable only from the
  // notice that says your ref was deleted. Every condition the escape row
  // renders under is counted here, so nothing downstream can disagree with it.
  const unpinRow =
    baseReason === "override" && !!defaultBranch && !!reviewRef && !!repoPath;
  // Where clearing a pin lands: the ladder's trunk arm for the default
  // branch — its working tree — and the whole branch vs the default for
  // everything else. The row is named for this, not for "whole branch"
  // unconditionally, which on a pinned trunk promised a comparison that
  // clearing doesn't produce.
  const unpinToTrunk = unpinRow && reviewRef === defaultBranch;
  // The trunk review *is* its working tree, so the uncommitted row would be
  // the row above it a second time, and "uncommitted work is included in the
  // whole branch" would be describing it as being inside itself. A pinned
  // trunk hides it for the same reason: the unpin row already lands on the
  // working tree, and two rows reading "Uncommitted" is one claim twice.
  const uncommittedRow =
    showUncommitted && baseReason !== "trunkWorkingTree" && !unpinToTrunk;

  const reviewHead = refLabel(reviewRef ?? reviewComparison.head);

  // The head, in the app's words, plus what kind of head it is. The tag is the
  // one-word answer to "can I act on this", which is why "working tree" wins
  // over the reason the base was chosen.
  const { headText, tag } = peek
    ? {
        headText: `${peek.shortHash} ${truncateSubject(peek.subject, 48)}`,
        tag: "commit",
      }
    : range
      ? {
          headText: truncateSubject(range.title, 48),
          tag:
            range.kind === "uncommitted"
              ? "working tree"
              : range.loOrdinal === range.hiOrdinal
                ? "commit"
                : "range",
        }
      : {
          headText: reviewHead,
          tag: checkedOut
            ? "working tree"
            : baseReason === "pullRequest"
              ? "PR"
              : baseReason === "singleCommit"
                ? "commit"
                : "branch",
        };

  // The quiet half: what the head is measured against. "Whole branch" named
  // the contents and left out the other end, which is the half nobody could
  // see and the whole of why a review reads bigger than the branch is.
  const baseText = peek
    ? `vs its parent${peek.isMerge ? " — merge shown against its first parent" : ""}`
    : range
      ? [
          `vs ${range.comparison.base}`,
          range.kind === "commits"
            ? plural(range.hiOrdinal - range.loOrdinal + 1, "commit")
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : [
          // A trunk review's base *is* its head, so "vs master" would be the
          // line claiming the branch differs from itself. What is on screen
          // there is simply the work not yet committed.
          baseReason === "trunkWorkingTree"
            ? "uncommitted changes"
            : `vs ${reviewComparison.base} · ${wholeSlice.descriptor}`,
          commits.length > 0 ? plural(commits.length, "commit") : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const tinted = !checkedOut;

  return (
    <Popover open={changeBaseOpen} onOpenChange={setChangeBaseOpen}>
      <PopoverAnchor asChild>
        <div
          className={`flex shrink-0 items-center rounded-md border ${
            tinted
              ? "border-status-modified/30 bg-status-modified/[0.07]"
              : "border-edge/60 bg-surface-raised/40"
          }`}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              {/* The trigger is its own two lines, so what opens the menu is
                  the text naming the comparison rather than a pane laid over
                  it — which is what the way back out of a slice, a button
                  beside this one, used to have to be cut out of. */}
              <button
                type="button"
                className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto]
                           items-center gap-x-2 rounded-md px-2 py-1.5 text-left
                           hover:bg-fg/[0.04] focus-visible:outline-none
                           focus-visible:ring-1 focus-visible:ring-focus-ring/70"
              >
                <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-1.5">
                  {/* The head reads the same either way — it is the *tag* and
                      the frame that carry "this isn't your checkout", so a
                      tinted bar is a state of the bar rather than a different
                      sentence. */}
                  <span className="truncate text-xs font-medium text-fg">
                    {headText}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1 text-xxs font-medium ${
                      tinted
                        ? "bg-status-modified/15 text-status-modified"
                        : "bg-fg/[0.08] text-fg-muted"
                    }`}
                  >
                    {tag}
                  </span>
                </span>
                <ChevronDownIcon className="col-start-2 row-span-2 row-start-1 size-3 shrink-0 text-fg-faint" />
                <span className="col-start-1 row-start-2 min-w-0 truncate text-xxs text-fg-faint">
                  {baseText}
                </span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              className="w-80"
              // Where the base picker is handed the focus the menu is giving
              // up. Opening it from the row's own `onSelect` raced the close:
              // the menu restores focus to its trigger on the way out, and a
              // popover that had already opened read that as a focus leaving
              // it and shut again. This is the one moment both are true — the
              // menu is going, and nothing has claimed the focus yet.
              onCloseAutoFocus={(e) => {
                if (!changeBasePending.current) return;
                changeBasePending.current = false;
                e.preventDefault();
                setChangeBaseOpen(true);
              }}
            >
              {/* The review's own comparison, named for what it actually is. */}
              <MenuRow
                label={wholeSlice.label}
                hint={wholeSlice.hint}
                selected={viewpoint.kind === "review"}
                onClick={() => select(null)}
              />

              {/* A pinned base is a slice like any other, so escaping it is
                  picking a different one rather than a verb of its own.
                  Clearing the override *is* picking the derived slice, so the
                  row is named for where clearing actually lands: a trunk review
                  falls back to its working tree, everything else to the whole
                  branch vs the default. */}
              {unpinRow && (
                <MenuRow
                  label={unpinToTrunk ? "Uncommitted" : "Whole branch"}
                  hint={unpinToTrunk ? "working tree" : `vs ${defaultBranch}`}
                  onClick={() => void clearBase(repoPath!, reviewRef!)}
                />
              )}

              {unpushedSlice && (
                <MenuRow
                  label="Unpushed"
                  hint={plural(unpushed, "commit")}
                  selected={sameRange(unpushedSlice, range)}
                  onClick={() => select(unpushedSlice)}
                />
              )}

              {uncommittedRow && (
                <MenuRow
                  label="Uncommitted"
                  hint={`vs ${reviewComparison.head}`}
                  selected={range?.kind === "uncommitted"}
                  onClick={() =>
                    select(uncommittedRange(reviewComparison.head))
                  }
                />
              )}

              {/* The honest footnote on the whole-branch row: with the head
                  branch checked out, core diffs against the working tree rather
                  than the head commit, so uncommitted work is already inside
                  every slice above except the ones bounded by two commits.
                  Nothing said so, and it is half of why a review reads bigger
                  than the branch is. */}
              {uncommittedRow && (
                <p className="px-2 pb-1 pt-0.5 text-xxs leading-4 text-fg-faint/70">
                  Uncommitted work is included in{" "}
                  {wholeSlice.inline ?? wholeSlice.label.toLowerCase()}.
                </p>
              )}

              {baseBehind > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {/* Not a row you can act on — git is the only thing that can
                      fix it — but the one fact that explains a file list nobody
                      recognizes, and it is invisible from inside the diff. */}
                  <p className="flex items-start gap-1.5 px-2 py-1 text-xxs leading-4 text-status-modified/90">
                    <WarningIcon className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      <span className="tabular-nums">{baseBehind}</span> commits
                      behind on {reviewComparison.base} — pull it to drop what
                      landed there from this diff.
                    </span>
                  </p>
                </>
              )}

              {(commits.length > 0 || attributionLoading) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <span className="flex-1">Commits</span>
                    {/* Said up front, because the list below is the one part of
                        this menu whose length is the branch's business rather
                        than the app's — thirty-four of them is worth knowing
                        before you start scrolling. */}
                    {commits.length > 0 && (
                      <span className="text-xxs font-normal text-fg-faint tabular-nums">
                        {commits.length}
                      </span>
                    )}
                  </DropdownMenuLabel>
                </>
              )}
              {attributionLoading && commits.length === 0 && (
                <p className="flex items-center gap-1.5 px-2 py-1 text-xxs text-fg-faint">
                  <Spinner className="h-3 w-3 border-2 border-edge-default border-t-status-modified" />
                  Loading commits…
                </p>
              )}
              {/* The commits scroll inside the menu rather than lengthening it.
                  A branch's commit count is the branch's business — on a long
                  one this list ran past the bottom of the window and took the
                  rows above it with it, so the slices, the warning and the whole
                  point of the menu were off screen behind a scroll nobody could
                  see the end of. Bounded here, they stay put and the list
                  moves. */}
              {commits.length > 0 && (
                <div className="max-h-56 overflow-y-auto scrollbar-thin">
                  {log.map(({ commit, ordinal }) => (
                    <CommitRow
                      key={commit.hash}
                      commit={commit}
                      selected={
                        range?.kind === "commits" &&
                        ordinal >= range.loOrdinal &&
                        ordinal <= range.hiOrdinal
                      }
                      onClick={(e) => {
                        shiftRef.current = e.shiftKey;
                        handleCommitClick(ordinal);
                      }}
                      onSelect={(e) => {
                        if (shiftRef.current) e.preventDefault();
                      }}
                    />
                  ))}
                </div>
              )}

              <DropdownMenuSeparator />
              {historyOpen ? (
                <>
                  <DropdownMenuLabel>History</DropdownMenuLabel>
                  {history.loading && (
                    <p className="flex items-center gap-1.5 px-2 py-1 text-xxs text-fg-faint">
                      <Spinner className="h-3 w-3 border-2 border-edge-default border-t-status-modified" />
                      Loading…
                    </p>
                  )}
                  {history.error && (
                    <p className="px-2 py-1 text-xxs text-status-rejected">
                      {history.error}
                    </p>
                  )}
                  <div className="max-h-56 overflow-y-auto scrollbar-thin">
                    {history.entries.map((commit) => (
                      <CommitRow
                        key={commit.hash}
                        commit={commit}
                        selected={commit.hash === peek?.hash}
                        onClick={() => openCommit(commit.hash)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <MenuRow
                  label={
                    <span className="text-fg-muted">
                      {commits.length > 0 ? "Older commits…" : "History…"}
                    </span>
                  }
                  onClick={() => setHistoryOpen(true)}
                  onSelect={(e) => e.preventDefault()}
                />
              )}

              {reviewRef && repoPath && (
                <>
                  <DropdownMenuSeparator />
                  <MenuRow
                    label="Change base…"
                    hint="any ref"
                    onSelect={() => {
                      changeBasePending.current = true;
                    }}
                  />
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* The way back sits beside the comparison it leaves rather than in
              a banner of its own above the diff: leaving a slice is a change
              of comparison like any other. */}
          {viewpoint.kind !== "review" && (
            <SimpleTooltip content={`Back to ${reviewHead}`}>
              <button
                type="button"
                aria-label={`Back to ${reviewHead}`}
                onClick={() => setViewpoint(REVIEW_VIEWPOINT)}
                className="max-w-24 shrink-0 truncate rounded pr-2 text-xxs
                           text-guide hover:underline focus-visible:outline-none
                           focus-visible:ring-1 focus-visible:ring-focus-ring/70"
              >
                {/* An arrow rather than the word, because at the panel's
                    width every character here comes out of the head's. */}
                ← {reviewHead}
              </button>
            </SimpleTooltip>
          )}
        </div>
      </PopoverAnchor>

      <PopoverContent align="start" className="w-auto p-0">
        {repoPath && reviewRef && (
          <ChangeBaseMenu
            repoPath={repoPath}
            refName={reviewRef}
            currentBase={reviewComparison.base}
            onClose={() => setChangeBaseOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
