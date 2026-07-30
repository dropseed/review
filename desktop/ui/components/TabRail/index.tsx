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
import { getApiClient } from "../../api";
import { useAllHunks } from "../../stores/selectors/hunks";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useAutoUpdater } from "../../hooks/useAutoUpdater";
import { computeReviewProgress } from "../../hooks/useReviewProgress";
import { getPlatformServices } from "../../platform";
import { TabRailItem } from "./TabRailItem";
import { type GlobalReviewSummary } from "../../types";
import { SidebarPanelIcon } from "../ui/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { SidebarResizeHandle } from "../ui/sidebar-resize-handle";
import { Spinner } from "../ui/spinner";
import { LspStatusIndicator } from "../LspStatusIndicator";
import { AgentUsageIndicator } from "../AgentUsageIndicator";
import { LocalBranchItem } from "./LocalBranchItem";
import { SidebarRail } from "./SidebarRail";
import { makeReviewKey } from "../../stores/slices/groupingSlice";
import { splitRoutePrefix } from "../../utils/repo-identity";

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
  type RepoNode,
  type SidebarRow,
  isRepoExpanded,
} from "../../utils/sidebar-tree";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { RemoteBranchItem } from "./RemoteBranchItem";
import { RowStatus } from "./RowStatus";
import {
  ROW_ACTIONS,
  ROW_LABEL_HOVER_FADE,
  ROW_MODIFIED_BADGE,
  ROW_STATUS,
} from "./row-chrome";
import { useTerminalTabDrop } from "./useTerminalTabDrop";

interface SidebarListProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}

function SidebarList({
  onActivateReview,
  onActivateLocalBranch,
}: SidebarListProps): ReactNode {
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
    if (entry.kind === "review") {
      return (
        <TabRailItem
          key={row.reviewKey}
          {...reviewItemPropsFor(entry.review)}
        />
      );
    }

    if (entry.kind === "remote-recent") {
      return (
        <RemoteBranchItem
          key={row.reviewKey}
          branchName={entry.branchName}
          remoteRef={entry.remoteRef}
          repoPath={entry.repoPath}
          defaultBranch={entry.defaultBranch}
          lastCommitDate={entry.lastCommitDate}
          onActivate={onActivateLocalBranch}
        />
      );
    }

    return (
      <LocalBranchItem
        key={row.reviewKey}
        branch={entry.branch}
        repoPath={row.repoPath}
        defaultBranch={entry.repo.defaultBranch}
        itemKind={entry.kind}
        checkoutPath={row.checkoutPath}
        onActivate={onActivateLocalBranch}
      />
    );
  }

  const isEmpty =
    tree.length === 0 && !globalReviewsLoading && !localActivityLoading;

  if (isEmpty) {
    return null;
  }

  const isLoading =
    globalReviewsLoading &&
    globalReviews.length === 0 &&
    localActivity.length === 0;

  if (isLoading) {
    return (
      <div role="tablist" className="pb-1">
        <div className="space-y-2 px-2 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-1">
              <div className="h-2.5 w-16 rounded bg-fg/[0.06]" />
              <div className="h-8 rounded bg-fg/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const active = tree.filter((node) => node.isActive);
  const quiet = tree.filter((node) => !node.isActive);

  return (
    <div role="tablist" className="pb-1 pt-0.5">
      {active.map((node) => (
        <RepoNodeView
          key={node.repoPath}
          node={node}
          renderRow={renderRow}
          onActivateLocalBranch={onActivateLocalBranch}
        />
      ))}

      {active.length === 0 && (
        <p className="px-2.5 py-1 text-[11px] leading-snug text-fg-faint/60">
          Nothing in flight — changes and recent branches show up here.
        </p>
      )}

      {quiet.length > 0 && (
        <QuietRepos
          nodes={quiet}
          renderRow={renderRow}
          onActivateLocalBranch={onActivateLocalBranch}
        />
      )}
    </div>
  );
}

/**
 * Repos with nothing live, behind one line. They stay reachable — this is the
 * whole browse tree — without the quiet majority pushing today's work off
 * screen.
 */
function QuietRepos({
  nodes,
  renderRow,
  onActivateLocalBranch,
}: {
  nodes: RepoNode[];
  renderRow: (row: SidebarRow) => ReactNode;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}): ReactNode {
  const showInactiveRepos = useReviewStore((s) => s.showInactiveRepos);
  const toggleInactiveRepos = useReviewStore((s) => s.toggleInactiveRepos);

  return (
    <div className="mt-1.5 border-t border-t-edge/40 pt-1">
      <button
        type="button"
        onClick={toggleInactiveRepos}
        aria-expanded={showInactiveRepos}
        className="flex items-center gap-1 w-full text-left px-2.5 py-1 rounded-sm
                   text-[10px] text-fg-faint/70 hover:text-fg-muted
                   hover:bg-fg/[0.03] transition-colors duration-100"
      >
        <span className="text-[8px] w-2 shrink-0">
          {showInactiveRepos ? "▾" : "▸"}
        </span>
        <span className="tabular-nums">
          {nodes.length} quiet {nodes.length === 1 ? "repo" : "repos"}
        </span>
      </button>
      {showInactiveRepos &&
        nodes.map((node) => (
          <RepoNodeView
            key={node.repoPath}
            node={node}
            renderRow={renderRow}
            onActivateLocalBranch={onActivateLocalBranch}
          />
        ))}
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
  const loadLocalActivity = useReviewStore((s) => s.loadLocalActivity);
  const handleFetch = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (fetching) return;
      setFetching(true);
      try {
        await getApiClient().fetchOrigin(repoPath);
        // A no-op fetch (everything up to date) only updates FETCH_HEAD,
        // which the watcher ignores — refresh activity ourselves so the
        // "last fetched" stamp ticks regardless.
        await loadLocalActivity();
      } catch (err) {
        console.error("[fetchOrigin] failed", err);
      } finally {
        setFetching(false);
      }
    },
    [fetching, repoPath, loadLocalActivity],
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
 * Linked worktrees, PRs and reviews hang beneath, live ones first, with the
 * quiet remainder one `⋯ more` away.
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
  const collapsedRepos = useReviewStore((s) => s.collapsedRepos);
  const setRepoCollapsed = useReviewStore((s) => s.setRepoCollapsed);
  const restOpen = useReviewStore(
    (s) => s.expandedRepoRest[node.repoPath] === true,
  );
  const toggleRepoRest = useReviewStore((s) => s.toggleRepoRest);
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const unregisterRepo = useReviewStore((s) => s.unregisterRepo);
  const removeRecentRepository = useReviewStore(
    (s) => s.removeRecentRepository,
  );
  const meta = useReviewStore((s) => s.repoMetadata[node.repoPath]);

  const [menuOpen, setMenuOpen] = useState(false);
  // The repo row is its head branch's row, so a tab dropped on it is homed
  // there — not on some repo-wide bucket the sidebar has no row for.
  const { dropClass, dropProps } = useTerminalTabDrop(
    node.repoPath,
    node.head?.ref ?? "",
  );

  const expanded = isRepoExpanded(collapsedRepos, node);
  const displayName = meta?.routePrefix
    ? splitRoutePrefix(meta.routePrefix).repo || node.repoName
    : node.repoName;

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

  const handleActivate = () => {
    if (!head || !node.defaultBranch) {
      // Nothing checked out to open — fall back to expanding, so the row still
      // does something useful.
      setRepoCollapsed(node.repoPath, expanded);
      return;
    }
    onActivateLocalBranch(node.repoPath, head.ref, node.defaultBranch);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRepoCollapsed(node.repoPath, expanded);
    if (!expanded) {
      // A quiet repo's reviews are outside the recurring freshness scope;
      // check them once when the user opens it.
      checkReviewsFreshness(
        [...node.live, ...node.rest].map((row) => row.reviewKey),
      ).catch(() => {});
    }
  };

  return (
    <div className="mt-1.5 first:mt-0">
      <div
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate();
          }
        }}
        onContextMenu={handleContextMenu}
        {...dropProps}
        className={`group relative flex items-center gap-1.5 w-full text-left px-2.5 py-1
                    transition-colors duration-100 rounded-sm cursor-default
                    ${headIsActive ? "bg-fg/[0.04]" : "hover:bg-fg/[0.04]"}
                    ${dropClass}`}
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
        {/* Disclosure on the left, so every row in the tree ends with its
            status cluster at the same x — nothing on the right edge is a
            per-row-type exception. */}
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center justify-center w-3 h-4 shrink-0 rounded
                     text-fg-faint/70 hover:text-fg-secondary
                     transition-colors duration-100"
          aria-label={expanded ? "Collapse repository" : "Expand repository"}
        >
          <span className="text-[9px]">{expanded ? "▾" : "▸"}</span>
        </button>
        {/* The org's avatar rides on the repo row: repos sort by activity, so
            two orgs interleave freely and the row has to say which it is. */}
        {meta?.avatarUrl ? (
          <img
            src={meta.avatarUrl}
            alt=""
            className="h-3.5 w-3.5 rounded-sm shrink-0 opacity-70"
          />
        ) : (
          <span className="h-3.5 w-3.5 rounded-sm shrink-0 bg-fg/[0.10]" />
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
          {headBranch?.hasWorkingTreeChanges && (
            <span className={ROW_MODIFIED_BADGE}>M</span>
          )}
          {head && (
            <RowStatus
              repoPath={node.repoPath}
              reviewRef={head.ref}
              checkoutPath={head.checkoutPath}
              tier={head.checkoutPath ? "materialized" : "fetched"}
            />
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
                <DropdownMenuItem onClick={handleRemove}>
                  Remove from sidebar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </span>
      </div>
      {expanded && (node.live.length > 0 || node.rest.length > 0) && (
        // Indented to sit under the repo row's avatar, so a child row's label
        // starts where its parent's identity does rather than left of it.
        <div className="ml-[18px] border-l border-l-fg/[0.06]">
          {node.live.map(renderRow)}
          {node.rest.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => toggleRepoRest(node.repoPath)}
                aria-expanded={restOpen}
                className="flex items-center gap-1 w-full text-left px-2.5 py-1 rounded
                           text-[10px] text-fg-faint/60 hover:text-fg-muted
                           hover:bg-fg/[0.03] transition-colors duration-100"
              >
                <span className="text-[8px] w-2 shrink-0">
                  {restOpen ? "▾" : "▸"}
                </span>
                <span className="tabular-nums">
                  {restOpen ? "less" : `${node.rest.length} more`}
                </span>
              </button>
              {restOpen && node.rest.map(renderRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Top header bar: "Reviews" label + new-review button + sidebar toggle.
 *
 * No sort control: repos sit in a fixed alphabetical order now, so a sort
 * dropdown would only reorder rows *within* a repo — not worth a permanent
 * button, and its funnel glyph read as a filter besides.
 */
function SidebarHeader({
  onToggle,
  onNewReview,
}: {
  onToggle: () => void;
  onNewReview: () => void;
}): ReactNode {
  return (
    <div className="shrink-0 px-2 py-2 flex items-center gap-1">
      <span className="pl-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
        Reviews
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onNewReview}
        className="flex items-center justify-center w-6 h-6 rounded
                   text-fg-muted hover:text-fg-secondary hover:bg-surface-raised
                   transition-colors"
        aria-label="New review"
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
}

export const TabRail = memo(function TabRail({
  onActivateReview,
  onActivateLocalBranch,
}: TabRailProps) {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const { updateAvailable, installing, installUpdate } = useAutoUpdater();

  const navigate = useNavigate();

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

  const handleAddReview = useCallback(() => {
    navigate("/new");
  }, [navigate]);

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
      {collapsed && (
        <SidebarRail
          onExpand={toggleTabRail}
          onActivateReview={onActivateReview}
          onActivateLocalBranch={onActivateLocalBranch}
        />
      )}

      <nav
        className={`tab-rail flex h-full shrink-0 flex-col
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
          <SidebarHeader
            onToggle={toggleTabRail}
            onNewReview={handleAddReview}
          />

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <SidebarList
              onActivateReview={onActivateReview}
              onActivateLocalBranch={onActivateLocalBranch}
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
