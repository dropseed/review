import { type ReactNode, memo, useCallback, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { useWorkspaces } from "../../stores/selectors/workspaces";
import {
  getSidebarTree,
  sidebarRowsByPr,
} from "../../stores/selectors/sidebar";
import { openRowInWorkspace } from "../../commands/workspaceCommands";
import { getPlatformServices } from "../../platform";
import { formatAge } from "../../utils/format-age";
import { prNeedsAttention } from "../../utils/sidebar-tree";
import type { ViewerPr } from "../../types";
import { Spinner } from "../ui/spinner";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { ChevronRightIcon, FilterIcon, RefreshIcon } from "../ui/icons";
import { PrBadge } from "./PrBadge";
import { prSummary } from "./pr-format";
import { drawerEmptyMessage, drawerPrs, prIdentity } from "./pr-drawer";
import { useWorkspaceContext } from "./workspace-context";

/**
 * What GitHub is holding for you that the queue isn't.
 *
 * The queue answers "what am I working on"; this answers the question that
 * precedes it — "what have I got out there" — and the two are deliberately not
 * the same list. A PR the queue already stands for is subtracted here (see
 * `pr-drawer`), so the drawer's count is a count of things to *pick up*, and
 * clicking one is the gesture that moves it across: the PR becomes a
 * workspace, and the row it left is gone.
 *
 * It lives at the foot of the sidebar, collapsed or expanded, because it is
 * not where you work — it is where you look before deciding what to work on.
 * Collapsed it still carries the count and the attention dot, which is the
 * whole of what a glance needs.
 *
 * With no `gh` on the machine the drawer doesn't render at all: a user who
 * doesn't do GitHub from here isn't missing a feature, and a permanently empty
 * section that can never fill is worse than no section.
 */
export const PullRequestsDrawer = memo(function PullRequestsDrawer() {
  const snapshot = useReviewStore((s) => s.viewerPrs);
  const refreshing = useReviewStore((s) => s.viewerPrsRefreshing);
  const refresh = useReviewStore((s) => s.refreshViewerPrs);
  const open = useReviewStore((s) => s.pullRequestsOpen);
  const toggle = useReviewStore((s) => s.togglePullRequests);
  const hiddenRepos = useReviewStore((s) => s.hiddenPrRepos);
  const workspaces = useWorkspaces();
  const ctx = useWorkspaceContext();

  const { shown, hidden, repos } = useMemo(
    () => drawerPrs(snapshot, workspaces, ctx, hiddenRepos),
    [snapshot, workspaces, ctx, hiddenRepos],
  );
  const attention = useMemo(() => shown.some(prNeedsAttention), [shown]);

  if (snapshot && !snapshot.available) return null;

  return (
    <div className="shrink-0 border-t border-t-edge/40">
      <div className="group flex items-center gap-1 py-1.5 pl-2 pr-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRightIcon
            className={clsx(
              "h-2.5 w-2.5 shrink-0 text-fg-muted/50 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="truncate text-[11px] font-medium leading-4 text-fg-muted">
            Pull requests
          </span>
          {shown.length > 0 && (
            <span className="shrink-0 text-[10px] tabular-nums leading-4 text-fg-faint">
              {shown.length}
            </span>
          )}
          {/* The one thing worth seeing while collapsed: something down there
              is red. Which one it is takes an expansion, and should. */}
          {attention && !open && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-pr-attention"
              title="A pull request has changes requested"
            />
          )}
        </button>
        <RepoFilter repos={repos} hiddenRepos={hiddenRepos} />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded
                     text-fg-faint opacity-0 transition-opacity hover:bg-surface-raised
                     hover:text-fg-secondary focus-visible:opacity-100
                     group-hover:opacity-100 disabled:opacity-100"
          aria-label="Refresh pull requests"
          title={
            snapshot
              ? `Updated ${formatAge(snapshot.fetchedAt)} ago`
              : "Refresh pull requests"
          }
        >
          {refreshing ? (
            <Spinner className="h-2.5 w-2.5 border-[1.5px] border-edge-strong border-t-fg-muted" />
          ) : (
            <RefreshIcon className="h-2.5 w-2.5" />
          )}
        </button>
      </div>

      {/* A fraction of the window rather than a fixed height: this list sits
          under the queue, and on a short window a drawer that keeps its full
          height is one that squeezes the thing you actually work in. */}
      {open && (
        <div className="max-h-[32vh] space-y-px overflow-y-auto px-1.5 pb-1.5 scrollbar-thin">
          {shown.map((pr) => (
            <PrRow key={prIdentity(pr)} pr={pr} />
          ))}
          {/* An error, or a filter, is its own account of why the list is
              empty — either together with this line would have the app both
              explaining and shrugging. */}
          {shown.length === 0 && hidden === 0 && !snapshot?.error && (
            <p className="px-1 py-1 text-[11px] leading-snug text-fg-faint/60">
              {drawerEmptyMessage(snapshot)}
            </p>
          )}
          {/* Stale data with a stated reason, never a confident empty list —
              the same rule the snapshot itself is built on. */}
          {snapshot?.error && (
            <p className="px-1 pt-1 text-[10px] leading-snug text-status-rejected/80">
              {shown.length > 0 ? "Last known — " : ""}
              {snapshot.error}
            </p>
          )}
          {snapshot?.truncated && (
            <p className="px-1 pt-1 text-[10px] leading-snug text-fg-faint/60">
              First 100 only — GitHub has more open.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

interface RepoFilterProps {
  repos: { repo: string; count: number }[];
  hiddenRepos: string[];
}

/**
 * Which repos the drawer is listening to.
 *
 * A checklist of every repo with an unpicked-up PR — including the ones
 * currently filtered out, since a repo you have silenced is one you can only
 * un-silence from a list that still shows it. The counts are what make the
 * choice informed: `dropseed/testing 14` is the row you came here to untick.
 *
 * It appears only when there is more than one repo to choose between. One repo
 * is not a filter, it is a switch for the whole drawer, and the drawer already
 * has one of those in its header.
 */
function RepoFilter({ repos, hiddenRepos }: RepoFilterProps): ReactNode {
  const [open, setOpen] = useState(false);
  const toggleRepo = useReviewStore((s) => s.togglePrRepoHidden);
  const showAll = useReviewStore((s) => s.showAllPrRepos);
  const filtering = hiddenRepos.length > 0;

  if (repos.length < 2) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            `flex h-5 w-5 shrink-0 items-center justify-center rounded
             transition-opacity hover:bg-surface-raised hover:text-fg-secondary`,
            // A filter that is on stays visible: it is the explanation for a
            // list being shorter than you expect, and an explanation you have
            // to hover to find is one nobody finds.
            filtering
              ? "text-fg-secondary opacity-100"
              : "text-fg-faint opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
          aria-label="Filter pull requests by repo"
          title={
            filtering
              ? `${hiddenRepos.length} repo${hiddenRepos.length === 1 ? "" : "s"} hidden`
              : "Filter by repo"
          }
        >
          <FilterIcon className="h-2.5 w-2.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-56 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-edge/40 px-3 py-2">
          <span className="text-xs font-medium text-fg-secondary">Repos</span>
          {filtering && (
            <button
              type="button"
              onClick={showAll}
              className="text-xxs text-fg-faint hover:text-fg-secondary"
            >
              Show all
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto py-1 scrollbar-thin">
          {repos.map(({ repo, count }) => {
            const checked = !hiddenRepos.includes(repo);
            return (
              <label
                key={repo}
                className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-surface-raised"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRepo(repo)}
                  className="h-3 w-3 shrink-0 accent-status-trusted"
                />
                <span
                  className={clsx(
                    "min-w-0 flex-1 truncate text-xs",
                    checked ? "text-fg-secondary" : "text-fg-faint",
                  )}
                  title={repo}
                >
                  {repo}
                </span>
                <span className="shrink-0 text-xxs tabular-nums text-fg-faint">
                  {count}
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Pick a PR up: land it in a workspace, and open it there.
 *
 * Through the tree's own row for the PR, so this commits exactly the decision
 * the sidebar already made about what that PR *is* — a branch you have, a
 * review you started, or nothing local at all — rather than a second opinion
 * formed in the drawer. `openRowInWorkspace` is the same verb ⌘K's Enter uses.
 *
 * Read out of the store at click time rather than closed over: the tree
 * changes on every git event in any registered repo, and a handler that
 * depended on it would re-render every row in the list each time.
 */
function pickUp(pr: ViewerPr): void {
  const row =
    pr.repoPath == null
      ? undefined
      : sidebarRowsByPr(getSidebarTree(useReviewStore.getState())).get(
          `${pr.repoPath}#${pr.number}`,
        );
  if (!row) {
    // Nothing local to land it in — a repo that isn't cloned here, or a
    // snapshot the tree hasn't caught up with. Sending it to the browser is
    // the honest verb: cloning a repo on a sidebar click is not something to
    // do to someone's disk without asking.
    getPlatformServices().opener.openUrl(pr.url);
    return;
  }
  void openRowInWorkspace(row);
}

/**
 * One PR: what GitHub says about it, and where it would land.
 *
 * The badge carries the state in the same octicon and colour the page does
 * (`PrBadge`), so nothing here restates it in words — the second line is for
 * the facts the badge can't hold: which repo, which number, how long it has
 * been sitting there.
 *
 * A PR in a repo this machine has no clone of can still be read, so the row
 * stays and its click goes to the browser instead. Those are exactly the
 * forgotten ones, and dropping them would make the list quietly incomplete.
 */
const PrRow = memo(function PrRow({ pr }: { pr: ViewerPr }): ReactNode {
  const local = pr.repoPath != null;
  const onClick = useCallback(() => pickUp(pr), [pr]);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${pr.title}\n${pr.repoNameWithOwner} · ${prSummary(pr)}${
        local ? "" : "\nOpens on GitHub — not cloned here"
      }`}
      className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left
                 transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised"
    >
      <PrBadge pr={pr} className="mt-px" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] leading-4 text-fg-secondary">
          {pr.title}
        </span>
        <span className="block truncate text-[9.5px] leading-4 text-fg-faint/70">
          {pr.repoNameWithOwner} · #{pr.number} · {formatAge(pr.updatedAt)}
          {local ? "" : " · on GitHub"}
        </span>
      </span>
    </button>
  );
});
