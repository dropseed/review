import {
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useAutoUpdater } from "../../hooks/useAutoUpdater";
import { computeReviewProgress } from "../../hooks/useReviewProgress";
import { getPlatformServices } from "../../platform";
import { TabRailItem } from "./TabRailItem";
import { type GlobalReviewSummary, type ViewerPr } from "../../types";
import { SidebarPanelIcon } from "../ui/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "../ui/dropdown-menu";
import { SidebarResizeHandle } from "../ui/sidebar-resize-handle";
import { Spinner } from "../ui/spinner";
import { LspStatusIndicator } from "../LspStatusIndicator";
import { AgentUsageIndicator } from "../AgentUsageIndicator";
import { LocalBranchItem } from "./LocalBranchItem";
import { SidebarRail } from "./SidebarRail";
import { makeReviewKey } from "../../stores/slices/groupingSlice";
import { repoDisplayName } from "../../utils/repo-identity";

const GITHUB_REPO_URL = "https://github.com/dropseed/review";

interface FooterVersionInfoProps {
  updateAvailable: { version: string } | null;
  installing: boolean;
  installUpdate: () => void;
  appVersion: string | null;
  onOpenRelease: () => void;
}

/** Displays either an update button or the current version in the footer. */
function FooterVersionInfo({
  updateAvailable,
  installing,
  installUpdate,
  appVersion,
  onOpenRelease,
}: FooterVersionInfoProps): ReactNode {
  if (updateAvailable) {
    return (
      <button
        type="button"
        onClick={installUpdate}
        disabled={installing}
        className="flex items-center gap-1.5 text-[10px] font-medium text-status-approved hover:text-status-approved transition-colors duration-100 disabled:opacity-50"
      >
        {installing ? (
          <>
            <Spinner className="h-2.5 w-2.5 border-[1.5px] border-edge-strong border-t-status-approved" />
            Installing…
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-status-approved" />
            Update to v{updateAvailable.version}
          </>
        )}
      </button>
    );
  }

  if (appVersion) {
    return (
      <button
        type="button"
        onClick={onOpenRelease}
        className="text-[10px] tabular-nums text-fg-faint hover:text-fg-muted transition-colors duration-100"
      >
        v{appVersion}
      </button>
    );
  }

  return null;
}

import {
  groupReposByOrg,
  prNeedsAttention,
  visibleRows,
  type OrgGroup,
  type OrgRepo,
  type RepoNode,
  type SidebarRow,
} from "../../utils/sidebar-tree";
import { useWorkCoveredKeys } from "../../stores/selectors/work";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { RemoteBranchItem } from "./RemoteBranchItem";
import { RowStatus } from "./RowStatus";
import {
  activateOnKey,
  ROW_ACTIONS,
  ROW_LABEL_HOVER_FADE,
  ROW_MODIFIED_BADGE,
  ROW_STATUS,
} from "./row-chrome";
import { OpenPrItem } from "./OpenPrItem";
import { ElsewherePrRow, SnapshotNote } from "./ElsewherePrRow";
import { WorkingOnSection } from "./WorkingOnSection";
import { UnclaimedTerminals } from "./UnclaimedTerminals";
import { requestAddWorkItem } from "./work-add";
import { ActionContextMenu, DropdownActionItems } from "./ActionMenu";
import {
  externalActions,
  fetchRepoOrigins,
  orgActions,
  repoRowActions,
  useAddToWork,
} from "./work-actions";
import { useWorkRefDrag } from "./work-row-drag";

interface ReposProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
  onActivateOpenPr: (pr: ViewerPr) => void;
}

/** Stands in for "no snapshot": a shared identity, so the grouping memo hits. */
const NO_PRS: ViewerPr[] = [];

/**
 * Every repo the sidebar knows, under its org.
 *
 * A browse surface, deliberately quiet. What is live and what needs you are
 * answered above it — by the user's own "Working on" queue and the unclaimed
 * terminals — so nothing here is promoted or hidden for being busy or idle. A
 * repo sits where its name puts it, and it is still there tomorrow.
 *
 * The orgs are the structure, so there is no section label: a word above the
 * headers could only be a vaguer name for what they already say. Repos this
 * machine doesn't have sit among the ones it does, under the same org, holding
 * their open PRs instead of a checkout.
 */
function Repos({
  onActivateReview,
  onActivateLocalBranch,
  onActivateOpenPr,
}: ReposProps): ReactNode {
  const tree = useSidebarTree();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  const localActivity = useReviewStore((s) => s.localActivity);
  const localActivityLoading = useReviewStore((s) => s.localActivityLoading);
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  const deleteGlobalReview = useReviewStore((s) => s.deleteGlobalReview);
  const reviewMissingRefs = useReviewStore((s) => s.reviewMissingRefs);

  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useAllHunks();
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const snapshot = useReviewStore((s) => s.viewerPrs);

  // `available: false` means `gh` is gone or logged out, and the backend serves
  // the *last cached* PRs alongside it. Those must not raise repo rows: an
  // uncloned repo appears only because a PR in it did, so a stale cache would
  // put whole repos in the list with nothing on screen saying they are stale.
  //
  // Attention-only for the same reason the band is terminals-only: a quiet
  // open PR in a repo this machine doesn't have is safe on GitHub and asks
  // nothing of you — a row for it is inventory, not signal. It comes back the
  // moment a review is requested or CI fails.
  const groups = useMemo(
    () =>
      groupReposByOrg(
        tree,
        repoMetadata,
        snapshot?.available ? snapshot.prs.filter(prNeedsAttention) : NO_PRS,
      ),
    [tree, repoMetadata, snapshot],
  );

  const liveProgress = useMemo(
    () => (reviewState ? computeReviewProgress(hunks, reviewState) : null),
    [hunks, reviewState],
  );

  const handleDeleteReview = useCallback(
    (review: GlobalReviewSummary) => {
      deleteGlobalReview(review.repoPath, review.ref);
      const active = useReviewStore.getState().activeReviewKey;
      if (active?.repoPath === review.repoPath && active?.ref === review.ref) {
        navigateRef.current("/");
      }
    },
    [deleteGlobalReview],
  );

  function reviewItemPropsFor(review: GlobalReviewSummary) {
    const meta = repoMetadata[review.repoPath];
    const key = makeReviewKey(review.repoPath, review.ref);

    const isCurrentReview =
      activeReviewKey?.repoPath === review.repoPath &&
      activeReviewKey?.ref === review.ref;

    const effectiveReview =
      isCurrentReview && liveProgress ? { ...review, ...liveProgress } : review;

    return {
      review: effectiveReview,
      repoName: meta?.routePrefix ?? review.repoName,
      defaultBranch: meta?.defaultBranch,
      missingRefs: reviewMissingRefs[key],
      onActivate: onActivateReview,
      onDelete: handleDeleteReview,
    };
  }

  function renderRow(row: SidebarRow): ReactNode {
    const { entry } = row;

    // A remote-only row has no checkout, so nothing can be homed to it.
    if (entry.kind === "remote-recent") {
      return (
        <RemoteBranchItem
          key={row.reviewKey}
          branchName={entry.branchName}
          remoteRef={entry.remoteRef}
          repoPath={entry.repoPath}
          defaultBranch={entry.defaultBranch}
          lastCommitDate={entry.lastCommitDate}
          openPr={row.openPr}
          onActivate={onActivateLocalBranch}
        />
      );
    }

    // Nor an open PR nothing local represents yet — it has no ref on disk at
    // all until activating it fetches one.
    if (entry.kind === "open-pr") {
      return (
        <OpenPrItem
          key={row.reviewKey}
          pr={entry.pr}
          repoPath={entry.repoPath}
          onActivate={onActivateOpenPr}
        />
      );
    }

    return entry.kind === "review" ? (
      <TabRailItem
        key={row.reviewKey}
        {...reviewItemPropsFor(entry.review)}
        openPr={row.openPr}
      />
    ) : (
      <LocalBranchItem
        key={row.reviewKey}
        branch={entry.branch}
        repoPath={row.repoPath}
        defaultBranch={entry.repo.defaultBranch}
        itemKind={entry.kind}
        checkoutPath={row.checkoutPath}
        openPr={row.openPr}
        onActivate={onActivateLocalBranch}
      />
    );
  }

  const isLoading =
    globalReviewsLoading &&
    globalReviews.length === 0 &&
    localActivity.length === 0;

  return (
    <div className="pb-1 pt-1">
      {isLoading ? (
        <div className="space-y-1 px-2 py-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-fg/[0.04]" />
          ))}
        </div>
      ) : (
        <div role="tablist">
          {groups.map((group) => (
            <OrgGroupView
              key={group.org}
              group={group}
              allOrgs={groups.map((g) => g.org)}
              renderRow={renderRow}
              onActivateLocalBranch={onActivateLocalBranch}
            />
          ))}
          {groups.length === 0 && !localActivityLoading && (
            <p className="px-2.5 py-1 text-[11px] leading-snug text-fg-faint/60">
              No repositories yet.
            </p>
          )}
        </div>
      )}

      <SnapshotNote />
    </div>
  );
}

/**
 * One org, and the repos under it.
 *
 * Expanded by default, unlike a repo: the header is the list's structure rather
 * than a thing you open, and an app that starts with every repo hidden behind a
 * chevron has no list at all. Collapsing one is how you put an org away for the
 * day, which is why that — and not the expansion — is what persists.
 */
function OrgGroupView({
  group,
  allOrgs,
  renderRow,
  onActivateLocalBranch,
}: {
  group: OrgGroup;
  /** Every org on screen — what "collapse the others" is about. */
  allOrgs: string[];
  renderRow: (row: SidebarRow) => ReactNode;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}): ReactNode {
  const collapsed = useReviewStore((s) => s.collapsedOrgs[group.org] === true);
  const setOrgCollapsed = useReviewStore((s) => s.setOrgCollapsed);
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const toggle = () => {
    setOrgCollapsed(group.org, !collapsed);
    if (collapsed) {
      // A collapsed org's reviews are outside the recurring freshness scope;
      // check them once when the user opens it. (This used to hang off the
      // per-repo disclosure, which no longer exists.)
      const keys = group.repos.flatMap((repo) =>
        repo.node ? repo.node.rows.map((row) => row.reviewKey) : [],
      );
      checkReviewsFreshness(keys).catch(() => {});
    }
  };

  return (
    <div className="pt-0.5">
      {/* No disclosure glyph: the whole header is the toggle, and the
          indentation below already says what a chevron would. */}
      <ActionContextMenu
        actions={orgActions({
          org: group.org,
          allOrgs,
          repoPaths: group.repos
            .map((repo) => repo.node?.repoPath)
            .filter((path): path is string => path != null),
        })}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={activateOnKey(toggle)}
          aria-expanded={!collapsed}
          className="flex w-full cursor-default items-center gap-1.5 rounded-sm px-2.5 py-1
                     transition-colors duration-100 hover:bg-fg/[0.03]"
          title={group.org}
        >
          {/* The org's avatar, once for the whole group — every repo row used
              to carry a copy of it to say which org it was in. */}
          {group.avatarUrl ? (
            <img
              src={group.avatarUrl}
              alt=""
              className="h-3.5 w-3.5 shrink-0 rounded-sm opacity-70"
            />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-fg/[0.10]" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg-muted">
            {group.org}
          </span>
          {/* Collapsed, the header still owes a hint of what it's hiding: how
              many repos, and whether any of them are dirty. Expanded, the rows
              themselves say it. */}
          {collapsed && (
            <span className="flex shrink-0 items-center gap-1.5">
              {group.repos.some(
                (repo) =>
                  repo.node &&
                  ((repo.node.head?.entry.kind === "working-tree" &&
                    repo.node.head.entry.branch.hasWorkingTreeChanges) ||
                    repo.node.rows.some((row) => row.facts.includes("dirty"))),
              ) && <span className={ROW_MODIFIED_BADGE}>M</span>}
              <span className="text-[10px] tabular-nums text-fg-faint/50">
                {group.repos.length}
              </span>
            </span>
          )}
        </div>
      </ActionContextMenu>
      {!collapsed && (
        // Indented so a repo's name starts where the org's label does — the
        // avatar column above is what the repos hang under.
        <div className="ml-5">
          {group.repos.map((repo) =>
            repo.node ? (
              <RepoNodeView
                key={repo.key}
                node={repo.node}
                renderRow={renderRow}
                onActivateLocalBranch={onActivateLocalBranch}
              />
            ) : (
              <UnclonedRepoView key={repo.key} repo={repo} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A repo this machine doesn't have, known only through your open PRs in it.
 *
 * It reads as a repo row because that is what it is — the org's work doesn't
 * stop being the org's work for being uncloned — but it is dimmed and carries
 * no status cluster, because everything a status cluster reports is about a
 * checkout there isn't one of. Expanding it lists the PRs; clicking one opens
 * GitHub, which is the only place they exist.
 */
function UnclonedRepoView({ repo }: { repo: OrgRepo }): ReactNode {
  // Keyed by `owner/repo` in the same record repo paths use — a path always
  // starts with "/", so the two can't collide.
  const expanded = useReviewStore((s) => s.expandedRepos[repo.key] === true);
  const setRepoExpanded = useReviewStore((s) => s.setRepoExpanded);
  const toggle = () => setRepoExpanded(repo.key, !expanded);

  // Its own page on the forge, taken from a PR in it — the only thing here
  // that knows the repo's URL, since nothing about it is on disk.
  const repoUrl = repo.prs[0]?.repoUrl ?? null;

  return (
    <div>
      <ActionContextMenu
        actions={repoUrl ? externalActions("unclonedRepo", repoUrl) : []}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={activateOnKey(toggle)}
          aria-expanded={expanded}
          className="group flex w-full cursor-default items-center gap-1.5 rounded-sm px-2.5 py-1
                     transition-colors duration-100 hover:bg-fg/[0.04]"
          title={`${repo.key} — not cloned here`}
        >
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-faint/50">
            {repo.name}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-fg-faint/50">
            {repo.prs.length}
          </span>
        </div>
      </ActionContextMenu>
      {expanded && (
        <div className="ml-[18px] border-l border-l-fg/[0.06]">
          {repo.prs.map((pr) => (
            <ElsewherePrRow key={pr.url} pr={pr} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatFetchedAgo(unixSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Fetch-from-origin control, on the repo row it refreshes.
 *
 * It sits here rather than over a "Remote (recent)" section because remote
 * branches are no longer a section — they're just the least-present rows in the
 * repo, and fetching is a repo-level act either way.
 */
function FetchButton({
  repoPath,
  lastFetchedAt,
}: {
  repoPath: string;
  lastFetchedAt: number | null;
}): ReactNode {
  const [fetching, setFetching] = useState(false);
  const handleFetch = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (fetching) return;
      setFetching(true);
      // The menu's "Fetch from origin" runs the same call — the button only
      // adds the spinner.
      await fetchRepoOrigins([repoPath]);
      setFetching(false);
    },
    [fetching, repoPath],
  );

  const title = lastFetchedAt
    ? `Last fetched ${formatFetchedAgo(lastFetchedAt)} — click to refresh`
    : "Click to fetch from origin";

  return (
    <button
      type="button"
      onClick={handleFetch}
      disabled={fetching}
      title={title}
      aria-label="Fetch from origin"
      className="flex items-center justify-center w-4 h-4 shrink-0 rounded
                 text-fg-faint hover:text-fg-secondary hover:bg-fg/[0.08]
                 disabled:opacity-50 transition-colors duration-100"
    >
      <span className={`text-[10px] ${fetching ? "animate-spin" : ""}`}>↻</span>
    </button>
  );
}

/**
 * One repo, and everything under it.
 *
 * The repo's row *is* its repo-root checkout — clicking it opens that review.
 * That identity is the point of the tree: there is no separate "repo root"
 * entry to disagree with the branch that happens to be checked out in it.
 *
 * Beneath it hangs one flat list with no fold: every row under a repo is there
 * because something is true about it that you haven't dealt with — files
 * checked out, changes uncommitted, commits unpushed, a PR open — and none of
 * those belong behind a `⋯ more`. What the fold used to hold was rows kept for
 * being *recent*, and those are no longer rows at all; ⌘K is where you reach a
 * branch the repo has nothing to say about.
 *
 * No per-repo disclosure either: most repos show nothing here, and the ones
 * that do are showing you the short list of what is actually open.
 *
 * No avatar of its own: the org header above it carries the identity now, and
 * repeating it on every row underneath said nothing the header hadn't.
 */
function RepoNodeView({
  node,
  renderRow,
  onActivateLocalBranch,
}: {
  node: RepoNode;
  renderRow: (row: SidebarRow) => ReactNode;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}): ReactNode {
  // Rows the user has claimed in "Working on" are reported by the card up
  // there — including the facts that would have put them here — so the tree
  // stays quiet about them rather than saying it twice.
  const covered = useWorkCoveredKeys();
  const rows = useMemo(() => visibleRows(node, covered), [node, covered]);
  const unregisterRepo = useReviewStore((s) => s.unregisterRepo);
  const removeRecentRepository = useReviewStore(
    (s) => s.removeRecentRepository,
  );
  const meta = useReviewStore((s) => s.repoMetadata[node.repoPath]);

  const [menuOpen, setMenuOpen] = useState(false);
  // The repo row is its head branch's row, so what it carries into "Working
  // on" is that branch — the same ref clicking it opens.
  const workDragProps = useWorkRefDrag(node.repoPath, node.head?.ref ?? "");
  const addToWork = useAddToWork(node.repoPath, node.head?.ref ?? "");

  const displayName = repoDisplayName(meta?.routePrefix, node.repoName);

  const head = node.head;
  // The head row is always a branch row — it's the repo's current HEAD.
  const headBranch =
    head?.entry.kind === "working-tree" ? head.entry.branch : null;

  const headIsActive = useReviewStore(
    (s) =>
      !!head &&
      s.activeReviewKey?.repoPath === node.repoPath &&
      s.activeReviewKey?.ref === head.ref,
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(true);
  };

  const handleRemove = () => {
    unregisterRepo(node.repoPath).catch((err) =>
      console.error("Failed to remove repo from sidebar:", err),
    );
    // Removing it from the sidebar should drop it from the welcome-page
    // recents too, or it reappears the moment the user opens it from there.
    removeRecentRepository(node.repoPath);
  };

  const repoActions = repoRowActions({
    repoPath: node.repoPath,
    // Nothing checked out means no ref to add — the row's other verbs still
    // apply to the repo itself.
    addToWork: head ? addToWork : null,
    browseUrl: meta?.browseUrl ?? null,
    onRemove: handleRemove,
  });

  const handleActivate = () => {
    if (!head || !node.defaultBranch) {
      // Nothing checked out to open — the rows below are already visible, so
      // there is nothing else for the click to do.
      return;
    }
    onActivateLocalBranch(node.repoPath, head.ref, node.defaultBranch);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={activateOnKey(handleActivate)}
        onContextMenu={handleContextMenu}
        {...workDragProps}
        className={`group relative flex items-center gap-1.5 w-full text-left px-2.5 py-1
                    transition-colors duration-100 rounded-sm cursor-default
                    ${headIsActive ? "bg-fg/[0.04]" : "hover:bg-fg/[0.04]"}`}
        aria-current={headIsActive ? "true" : undefined}
        title={
          headBranch
            ? `${displayName} — on ${headBranch.name}`
            : `${displayName} — nothing checked out`
        }
      >
        {headIsActive && (
          <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-full bg-fg/30" />
        )}
        <span className="text-[11px] text-fg-muted truncate shrink-0">
          {displayName}
        </span>
        {/* Doubles as the row's spacer, so the branch name is measured against
            the trailing edge — which is what makes the hover fade land on the
            actions rather than on the last word of a short name. */}
        <span
          className={`flex flex-1 items-center gap-1 min-w-0 ${ROW_LABEL_HOVER_FADE}`}
        >
          {headBranch && (
            <>
              <span className="text-[10px] text-fg-faint/40 shrink-0">·</span>
              <span className="text-[11px] text-fg-faint truncate">
                {headBranch.name}
              </span>
            </>
          )}
        </span>
        {/* Status keeps its place in the flow and stays interactive; the
            actions appear just left of it (see row-chrome), so the row's right
            edge holds still without the label paying for their width at rest. */}
        <span className={ROW_STATUS}>
          {head && (
            <RowStatus
              checkoutPath={head.checkoutPath}
              tier={head.checkoutPath ? "materialized" : "fetched"}
              openPr={head.openPr}
            />
          )}
          {headBranch?.hasWorkingTreeChanges && (
            <span className={ROW_MODIFIED_BADGE}>M</span>
          )}
          <span
            className={`${ROW_ACTIONS} ${
              menuOpen
                ? "opacity-100"
                : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
            }`}
          >
            <FetchButton
              repoPath={node.repoPath}
              lastFetchedAt={node.lastFetchedAt}
            />
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center w-4 h-4 shrink-0 rounded
                             text-fg-faint hover:text-fg-secondary hover:bg-fg/[0.08]"
                  aria-label="Repository options"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownActionItems actions={repoActions} />
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </span>
      </div>
      {rows.length > 0 && (
        <div className="ml-[18px] border-l border-l-fg/[0.06]">
          {rows.map(renderRow)}
        </div>
      )}
    </div>
  );
}

/**
 * Top header bar: add-work-item button and the sidebar toggle, right-aligned.
 *
 * No title. The sidebar names its own layers now — "Working on", "Unclaimed
 * terminals", and the org headers — and a word above all three could only be a
 * less accurate one. What's left is the two controls, sitting where the window
 * chrome is rather than under a label of their own.
 */
function SidebarHeader({ onToggle }: { onToggle: () => void }): ReactNode {
  return (
    <div className="shrink-0 px-2 py-2 flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={requestAddWorkItem}
        className="flex items-center justify-center w-6 h-6 rounded
                   text-fg-muted hover:text-fg-secondary hover:bg-surface-raised
                   transition-colors"
        aria-label="Add work item"
        title="Add work item"
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-center w-6 h-6 shrink-0 rounded
                   hover:bg-fg/[0.08] transition-colors duration-100
                   text-fg-muted hover:text-fg-secondary"
        aria-label="Hide sidebar"
      >
        <SidebarPanelIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface TabRailProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
  onActivateOpenPr: (pr: ViewerPr) => void;
}

export const TabRail = memo(function TabRail({
  onActivateReview,
  onActivateLocalBranch,
  onActivateOpenPr,
}: TabRailProps) {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const { updateAvailable, installing, installUpdate } = useAutoUpdater();

  const { sidebarWidth, isResizing, handleResizeStart } = useSidebarResize({
    sidebarPosition: "left",
    initialWidth: 14,
    minWidth: 10,
    maxWidth: 24,
  });

  useEffect(() => {
    getPlatformServices()
      .window.getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  function handleOpenRelease(): void {
    getPlatformServices().opener.openUrl(
      `${GITHUB_REPO_URL}/releases/tag/v${appVersion}`,
    );
  }

  return (
    <div className="relative flex shrink-0">
      {/* Collapsed, the sidebar keeps its column as a rail rather than
          vanishing — the way back lives on the sidebar's own edge instead of
          floating over whichever view is mounted. The nav below stays mounted
          at zero width so expanding is a width animation, not a remount. */}
      {collapsed && <SidebarRail onExpand={toggleTabRail} />}

      {/* select-none for the whole sidebar: rows are things you click and drag,
          not text you select — a double-click while triaging shouldn't leave a
          branch name highlighted. */}
      <nav
        className={`tab-rail flex h-full shrink-0 select-none flex-col
                   bg-surface border-r border-edge overflow-hidden
                   ${isResizing ? "" : "transition-[width,opacity] duration-200 ease-out"}`}
        style={{
          width: collapsed ? 0 : `${sidebarWidth}rem`,
          opacity: collapsed ? 0 : 1,
        }}
        aria-label="Reviews"
        aria-hidden={collapsed}
      >
        <div
          className="flex flex-col h-full min-w-0"
          style={{ width: `${sidebarWidth}rem` }}
        >
          <SidebarHeader onToggle={toggleTabRail} />

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <WorkingOnSection />
            <UnclaimedTerminals />
            <Repos
              onActivateReview={onActivateReview}
              onActivateLocalBranch={onActivateLocalBranch}
              onActivateOpenPr={onActivateOpenPr}
            />
          </div>

          <AgentUsageIndicator />

          <div className="shrink-0 px-3 py-3 border-t border-t-edge/40">
            <div className="flex items-center justify-between">
              <LspStatusIndicator />
              <FooterVersionInfo
                updateAvailable={updateAvailable}
                installing={installing}
                installUpdate={installUpdate}
                appVersion={appVersion}
                onOpenRelease={handleOpenRelease}
              />
            </div>
          </div>
        </div>

        {!collapsed && (
          <SidebarResizeHandle
            position="right"
            onMouseDown={handleResizeStart}
          />
        )}
      </nav>
    </div>
  );
});
