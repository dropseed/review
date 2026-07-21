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
import type { ReviewSortOrder } from "../../stores/slices/preferencesSlice";
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
import { SortMenu } from "../FilesPanel/SortMenu";
import { LocalBranchItem } from "./LocalBranchItem";
import { makeReviewKey } from "../../stores/slices/groupingSlice";
import { splitRoutePrefix } from "../../utils/repo-identity";

const GITHUB_REPO_URL = "https://github.com/dropseed/review";

const SORT_OPTIONS: [ReviewSortOrder, string][] = [
  ["updated", "Last updated"],
  ["repo", "Repository"],
  ["size", "Size"],
];

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
  type SidebarEntry,
  type RepoGroup,
  type OrgGroup,
  isRepoCollapsed,
} from "../../utils/sidebar-ordering";
import { type WorkingOnEntry } from "../../utils/working-on";
import { useOrgGroups, useWorkingOn } from "../../hooks/useRepoGroups";
import { RemoteBranchItem } from "./RemoteBranchItem";

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
  const orgGroups = useOrgGroups();
  const workingOn = useWorkingOn();
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

  function renderEntry(entry: SidebarEntry): ReactNode {
    if (entry.kind === "review") {
      return (
        <TabRailItem
          key={entry.reviewKey}
          {...reviewItemPropsFor(entry.review)}
        />
      );
    }

    if (entry.kind === "remote-recent") {
      return (
        <RemoteBranchItem
          key={entry.reviewKey}
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
        key={entry.reviewKey}
        branch={entry.branch}
        repoPath={entry.repo.repoPath}
        defaultBranch={entry.repo.defaultBranch}
        itemKind={entry.kind}
        onActivate={onActivateLocalBranch}
      />
    );
  }

  /** Short repo name for a zone-1 `repo / branch` label (route-prefix aware). */
  function repoDisplayName(repoPath: string, fallback: string): string {
    const routePrefix = repoMetadata[repoPath]?.routePrefix;
    return routePrefix
      ? splitRoutePrefix(routePrefix).repo || fallback
      : fallback;
  }

  /**
   * Render a zone-1 "Working on" row, reusing the existing row components.
   * `repoLabel` prefixes the row with `repo / `; the group's lead row passes
   * it, the rows nested under it don't.
   */
  function renderWorkingOn(wo: WorkingOnEntry, repoLabel?: string): ReactNode {
    const { entry } = wo;
    if (entry.kind === "review") {
      return (
        <TabRailItem
          key={`wo:${wo.reviewKey}`}
          {...reviewItemPropsFor(entry.review)}
          repoLabel={repoLabel}
        />
      );
    }
    return (
      <LocalBranchItem
        key={`wo:${wo.reviewKey}`}
        branch={entry.branch}
        repoPath={entry.repo.repoPath}
        repoName={repoLabel}
        defaultBranch={entry.repo.defaultBranch}
        itemKind={entry.kind}
        flat
        onActivate={onActivateLocalBranch}
      />
    );
  }

  const totalItems = orgGroups.reduce(
    (n, org) => n + org.repos.reduce((m, r) => m + r.items.length, 0),
    0,
  );

  const isEmpty =
    totalItems === 0 &&
    workingOn.length === 0 &&
    !globalReviewsLoading &&
    !localActivityLoading;

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

  // Repos with no remote yet (or only one local repo total) should not get
  // wrapped in a stutter "local" org header.
  const suppressLocalOrgHeader =
    orgGroups.length === 1 ||
    (orgGroups.find((g) => g.isLocal)?.repos.length ?? 0) <= 1;

  return (
    <div role="tablist" className="pb-1">
      {/* Zone 1 — "Working on": activity-derived, bucketed by repo. */}
      <div className="pt-0.5">
        <Zone zone="working-on" label="Working on">
          {workingOn.length > 0 ? (
            workingOn.map((group) => (
              // The group's lead row (its default branch when it has one)
              // doubles as the header: a `repo / branch` line, with the repo's
              // other branches indented beneath it. A repo with a single row
              // is just this line on its own.
              <div key={group.repoPath} className="mt-1.5 first:mt-0">
                {renderWorkingOn(
                  group.entries[0],
                  repoDisplayName(group.repoPath, group.repoName),
                )}
                {group.entries.length > 1 && (
                  <div className="ml-2 border-l border-l-fg/[0.06] pl-0.5">
                    {group.entries.slice(1).map((wo) => renderWorkingOn(wo))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="px-2.5 py-1 text-[11px] leading-snug text-fg-faint/60">
              Nothing in flight — changes and recent branches show up here.
            </p>
          )}
        </Zone>
      </div>

      {/* Zone 2 — browse: the full org → repo tree, collapsed by default. */}
      <div className="mt-2 border-t border-t-edge/40 pt-1.5">
        <Zone zone="repositories" label="Repositories">
          {orgGroups.map((org) => (
            <OrgSection
              key={org.org}
              org={org}
              suppressHeader={org.isLocal && suppressLocalOrgHeader}
              renderEntry={renderEntry}
              onActivateLocalBranch={onActivateLocalBranch}
            />
          ))}
        </Zone>
      </div>
    </div>
  );
}

/** Collapsible top-level sidebar zone with a quiet uppercase header. */
function Zone({
  zone,
  label,
  children,
}: {
  zone: string;
  label: string;
  children: ReactNode;
}): ReactNode {
  const collapsed = useReviewStore((s) => s.collapsedZones[zone] === true);
  const toggleZoneCollapsed = useReviewStore((s) => s.toggleZoneCollapsed);
  return (
    <>
      <button
        type="button"
        onClick={() => toggleZoneCollapsed(zone)}
        className="flex items-center gap-1 w-full text-left px-2.5 pb-1 pt-1
                   hover:bg-fg/[0.03] transition-colors duration-100 rounded-sm"
        aria-expanded={!collapsed}
      >
        <span className="text-[8px] text-fg-faint/60 w-2 shrink-0">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
          {label}
        </span>
      </button>
      {!collapsed && children}
    </>
  );
}

/** An org bucket containing one or more repos. */
function OrgSection({
  org,
  suppressHeader,
  renderEntry,
  onActivateLocalBranch,
}: {
  org: OrgGroup;
  suppressHeader: boolean;
  renderEntry: (entry: SidebarEntry) => ReactNode;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}): ReactNode {
  const collapsedOrgs = useReviewStore((s) => s.collapsedOrgs);
  const toggleOrgCollapsed = useReviewStore((s) => s.toggleOrgCollapsed);
  const repoMetadata = useReviewStore((s) => s.repoMetadata);

  const collapsed = collapsedOrgs[org.org] === true;
  const repoCount = org.repos.length;

  return (
    <div className="mt-1.5 first:mt-0 border-t border-t-edge/30 first:border-t-0 pt-1.5">
      {!suppressHeader && (
        <button
          type="button"
          onClick={() => toggleOrgCollapsed(org.org)}
          className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 mb-0.5
                     hover:bg-fg/[0.04] transition-colors duration-100 rounded-sm"
        >
          {org.avatarUrl ? (
            <img
              src={org.avatarUrl}
              alt=""
              className="h-4 w-4 rounded-sm shrink-0 opacity-70"
            />
          ) : (
            <span className="h-4 w-4 rounded-sm shrink-0 bg-fg/[0.10]" />
          )}
          <span className="flex-1 text-[11px] text-fg-muted truncate">
            {org.org}
          </span>
          {collapsed && (
            <span className="text-[10px] tabular-nums text-fg-faint/70">
              {repoCount}
            </span>
          )}
          <span className="text-[9px] text-fg-faint">
            {collapsed ? "▸" : "▾"}
          </span>
        </button>
      )}
      {!collapsed && (
        <div className={suppressHeader ? "" : "ml-3"}>
          {org.repos.map((repo) => {
            const routePrefix = repoMetadata[repo.repoPath]?.routePrefix;
            const displayName = routePrefix
              ? splitRoutePrefix(routePrefix).repo || repo.repoName
              : repo.repoName;
            return (
              <RepoGroupHeader
                key={repo.repoPath}
                group={repo}
                displayName={displayName}
                renderEntry={renderEntry}
                onActivateLocalBranch={onActivateLocalBranch}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Section label inside an expanded repo (e.g., "In review"). */
function SectionHeader({ label }: { label: string }): ReactNode {
  return (
    <div className="px-2 pt-2 pb-0.5">
      <span className="text-[10px] text-fg-faint/60">{label}</span>
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

/** "Remote (recent)" header with a manual fetch button and last-fetched stamp. */
function RemoteSectionHeader({
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

  const stamp = lastFetchedAt
    ? formatFetchedAgo(lastFetchedAt)
    : "never fetched";
  const title = lastFetchedAt
    ? `Last fetched ${stamp} — click to refresh`
    : "Click to fetch from origin";

  return (
    <div className="px-2 pt-2 pb-0.5 flex items-center gap-1.5">
      <span className="text-[10px] text-fg-faint/60">Remote (recent)</span>
      <span className="text-[10px] text-fg-faint/40 truncate">· {stamp}</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={handleFetch}
        disabled={fetching}
        title={title}
        aria-label="Fetch from origin"
        className="flex items-center justify-center w-4 h-4 shrink-0 rounded
                   text-fg-faint/70 hover:text-fg-secondary hover:bg-fg/[0.08]
                   disabled:opacity-50 transition-colors duration-100"
      >
        <span className={`text-[10px] ${fetching ? "animate-spin" : ""}`}>
          ↻
        </span>
      </button>
    </div>
  );
}

/** Repo row with persistent collapse and three sections. */
function RepoGroupHeader({
  group,
  displayName,
  renderEntry,
  onActivateLocalBranch,
}: {
  group: RepoGroup;
  displayName: string;
  renderEntry: (entry: SidebarEntry) => ReactNode;
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}) {
  const collapsedRepos = useReviewStore((s) => s.collapsedRepos);
  const setRepoCollapsed = useReviewStore((s) => s.setRepoCollapsed);
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const unregisterRepo = useReviewStore((s) => s.unregisterRepo);
  const removeRecentRepository = useReviewStore(
    (s) => s.removeRecentRepository,
  );
  const collapsed = isRepoCollapsed(collapsedRepos, group.repoPath);

  const [menuOpen, setMenuOpen] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(true);
  };

  const handleRemove = () => {
    unregisterRepo(group.repoPath).catch((err) =>
      console.error("Failed to remove repo from sidebar:", err),
    );
    // Removing it from the sidebar should drop it from the welcome-page
    // recents too, or it reappears the moment the user opens it from there.
    removeRecentRepository(group.repoPath);
  };

  const currentHead = group.branches.find((e) => e.kind === "working-tree");
  const canActivate = !!(currentHead && group.defaultBranch);

  const handleActivate = () => {
    if (!canActivate) {
      // No working-tree entry — fall back to toggling collapse so the row
      // still does something useful.
      setRepoCollapsed(group.repoPath, !collapsed);
      return;
    }
    onActivateLocalBranch(
      group.repoPath,
      currentHead!.branch.name,
      group.defaultBranch,
    );
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const willExpand = collapsed;
    setRepoCollapsed(group.repoPath, !collapsed);
    if (willExpand) {
      // Browse-zone reviews are outside the recurring (zone-1) freshness scope;
      // check this repo's reviews once when the user opens it.
      checkReviewsFreshness(group.items.map((it) => it.reviewKey)).catch(
        () => {},
      );
    }
  };

  const headBranch = currentHead?.branch;
  const headIsActive = useReviewStore(
    (s) =>
      !!currentHead &&
      s.activeReviewKey?.repoPath === group.repoPath &&
      s.activeReviewKey?.ref === currentHead.ref,
  );

  // The working-tree entry is surfaced in the repo header, so exclude it from
  // the Branches section list (would otherwise render twice).
  const branchesRest = group.branches.filter((e) => e.kind !== "working-tree");

  return (
    <div className="mt-0.5 first:mt-0">
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
        className={`group relative flex items-center gap-1.5 w-full text-left px-2.5 py-1
                    transition-colors duration-100 rounded-sm cursor-default
                    ${headIsActive ? "bg-fg/[0.04]" : "hover:bg-fg/[0.04]"}`}
        aria-current={headIsActive ? "true" : undefined}
        title={
          headBranch ? `${displayName} — on ${headBranch.name}` : displayName
        }
      >
        {headIsActive && (
          <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-full bg-fg/30" />
        )}
        <span className="text-[11px] text-fg-muted truncate shrink-0">
          {displayName}
        </span>
        {headBranch && (
          <span className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] text-fg-faint/40 shrink-0">/</span>
            <span className="text-[11px] text-fg-faint truncate">
              {headBranch.name}
            </span>
            {headBranch.hasWorkingTreeChanges && (
              <span className="text-[10px] text-status-modified shrink-0">
                M
              </span>
            )}
          </span>
        )}
        <span className="flex-1" />
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={`items-center justify-center w-4 h-4 shrink-0 rounded
                         text-fg-faint hover:text-fg-secondary hover:bg-fg/[0.08]
                         ${menuOpen ? "flex" : "hidden group-hover:flex"}`}
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
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center justify-center w-4 h-4 shrink-0 rounded
                     text-fg-faint hover:text-fg-secondary hover:bg-fg/[0.08]
                     transition-colors duration-100"
          aria-label={collapsed ? "Expand branches" : "Collapse branches"}
        >
          <span className="text-[9px]">{collapsed ? "▸" : "▾"}</span>
        </button>
      </div>
      {!collapsed && (
        <div className="ml-2 border-l border-l-fg/[0.06] pl-0.5">
          {branchesRest.length > 0 && (
            <>
              <SectionHeader label="Branches" />
              {branchesRest.map(renderEntry)}
            </>
          )}
          {group.pinned.length > 0 && (
            <>
              <SectionHeader label="Pinned" />
              {group.pinned.map(renderEntry)}
            </>
          )}
          {group.remoteRecent.length > 0 && (
            <>
              <RemoteSectionHeader
                repoPath={group.repoPath}
                lastFetchedAt={group.lastFetchedAt}
              />
              {group.remoteRecent.map(renderEntry)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Top header bar: "Reviews" label + sort/add actions + sidebar toggle. */
function SidebarHeader({
  onToggle,
  onNewReview,
}: {
  onToggle: () => void;
  onNewReview: () => void;
}): ReactNode {
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const reviewSortOrder = useReviewStore((s) => s.reviewSortOrder);
  const setReviewSortOrder = useReviewStore((s) => s.setReviewSortOrder);

  return (
    <div className="shrink-0 px-2 py-2 flex items-center gap-1">
      <span className="pl-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
        Reviews
      </span>
      <span className="flex-1" />
      {globalReviews.length > 0 && (
        <SortMenu
          options={SORT_OPTIONS}
          value={reviewSortOrder}
          onChange={setReviewSortOrder}
          ariaLabel="Sort reviews"
        />
      )}
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
  onOpenSettings: () => void;
}

export const TabRail = memo(function TabRail({
  onActivateReview,
  onActivateLocalBranch,
  onOpenSettings,
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

  function handleOpenFeedback(): void {
    getPlatformServices().opener.openUrl(`${GITHUB_REPO_URL}/issues`);
  }

  function handleOpenRelease(): void {
    getPlatformServices().opener.openUrl(
      `${GITHUB_REPO_URL}/releases/tag/v${appVersion}`,
    );
  }

  return (
    <div className="relative flex shrink-0" data-tauri-drag-region>
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

          <div className="shrink-0 px-3 py-3 border-t border-t-edge/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="p-1.5 rounded text-fg-faint hover:text-fg-muted hover:bg-fg/[0.06]
                             transition-colors duration-100"
                  aria-label="Settings"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleOpenFeedback}
                  className="p-1.5 rounded text-fg-faint hover:text-fg-muted hover:bg-fg/[0.06]
                             transition-colors duration-100"
                  aria-label="Send feedback"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <LspStatusIndicator />
              </div>
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
