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
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useAutoUpdater } from "../../hooks/useAutoUpdater";
import { computeReviewProgress } from "../../hooks/useReviewProgress";
import { getPlatformServices } from "../../platform";
import { TabRailItem } from "./TabRailItem";
import {
  makeComparison,
  type GlobalReviewSummary,
  type DiffShortStat,
} from "../../types";
import type { ReviewSortOrder } from "../../stores/slices/preferencesSlice";
import { SidebarPanelIcon } from "../ui/icons";
import { SidebarResizeHandle } from "../ui/sidebar-resize-handle";
import { LspStatusIndicator } from "../LspStatusIndicator";
import { SortMenu } from "../FilesPanel/SortMenu";
import { LocalBranchItem } from "./LocalBranchItem";
import { makeReviewKey } from "../../stores/slices/groupingSlice";
import {
  makeBranchKey,
  LOCAL_REPO_DEFAULT_COLLAPSED,
} from "../../stores/slices/localActivitySlice";

const GITHUB_REPO_URL = "https://github.com/dropseed/review";

const SORT_OPTIONS: [ReviewSortOrder, string][] = [
  ["updated", "Last updated"],
  ["repo", "Repository"],
  ["size", "Size"],
];

/** Compare two reviews by updatedAt descending (most recent first). */
function compareByUpdated(
  a: GlobalReviewSummary,
  b: GlobalReviewSummary,
): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/** Get the total changed lines for a review, falling back to hunk count. */
function reviewSize(
  review: GlobalReviewSummary,
  diffStats: Record<string, DiffShortStat>,
): number {
  const stats =
    diffStats[makeReviewKey(review.repoPath, review.comparison.key)];
  return stats ? stats.additions + stats.deletions : review.totalHunks;
}

/** Sort reviews by the given order. */
function sortReviews(
  reviews: GlobalReviewSummary[],
  order: ReviewSortOrder,
  diffStats: Record<string, DiffShortStat>,
): GlobalReviewSummary[] {
  switch (order) {
    case "repo":
      return [...reviews].sort((a, b) => {
        return a.repoName.localeCompare(b.repoName) || compareByUpdated(a, b);
      });
    case "size":
      return [...reviews].sort((a, b) => {
        return reviewSize(b, diffStats) - reviewSize(a, diffStats);
      });
    case "updated":
    default:
      return [...reviews].sort(compareByUpdated);
  }
}

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
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-edge-strong border-t-status-approved animate-spin" />
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

/** Collapsible section header for the tab rail sidebar, styled like right sidebar sections. */
function SidebarSectionHeader({
  title,
  icon,
  isOpen,
  onToggle,
  trailing,
}: {
  title: string;
  icon: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <div className="border-t border-t-edge/40">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1.5 pl-3 pr-2 py-2 text-left text-xs font-medium text-fg-secondary hover:bg-fg/[0.04] transition-colors duration-100"
        >
          {icon}
          <span className="flex-1">{title}</span>
        </button>
        {isOpen && (
          <div className="flex items-center gap-0.5 pr-2">{trailing}</div>
        )}
      </div>
    </div>
  );
}

interface LocalSectionsProps {
  onActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
}

/** Single "Local" section with a toggle between Working Changes and All Branches views. */
function LocalSection({
  onActivateLocalBranch,
}: LocalSectionsProps): ReactNode {
  const navigate = useNavigate();
  const localActivity = useReviewStore((s) => s.localActivity);
  const localActivityLoading = useReviewStore((s) => s.localActivityLoading);
  const localRepoCollapsed = useReviewStore((s) => s.localRepoCollapsed);
  const toggleLocalRepoCollapsed = useReviewStore(
    (s) => s.toggleLocalRepoCollapsed,
  );
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  const viewMode = useReviewStore((s) => s.localViewMode);
  const setLocalViewMode = useReviewStore((s) => s.setLocalViewMode);
  const unregisterRepo = useReviewStore((s) => s.unregisterRepo);

  const [sectionOpen, setSectionOpen] = useState(true);

  // All repos sorted by name, filter to those with branches
  const activeRepos = useMemo(
    () =>
      localActivity
        .filter((r) => r.branches.length > 0)
        .sort((a, b) => a.repoName.localeCompare(b.repoName)),
    [localActivity],
  );

  // Separate branches with working tree changes (for Changes view)
  // and build full repo list with wt-changes sorted first (for All view)
  const { workingTreeBranches, allRepos } = useMemo(() => {
    const wt: {
      branch: (typeof activeRepos)[0]["branches"][0];
      repo: (typeof activeRepos)[0];
    }[] = [];
    // Build repos with wt-change branches sorted to top
    const repos = activeRepos.map((repo) => {
      const wtBranches: typeof repo.branches = [];
      const otherBranches: typeof repo.branches = [];
      for (const b of repo.branches) {
        if (b.hasWorkingTreeChanges) {
          wt.push({ branch: b, repo });
          wtBranches.push(b);
        } else {
          otherBranches.push(b);
        }
      }
      return { ...repo, branches: [...wtBranches, ...otherBranches] };
    });
    // Sort working tree branches by most recently modified file
    wt.sort(
      (a, b) => (b.branch.lastModifiedAt ?? 0) - (a.branch.lastModifiedAt ?? 0),
    );
    return { workingTreeBranches: wt, allRepos: repos };
  }, [activeRepos]);

  if (localActivityLoading && activeRepos.length === 0) {
    return null;
  }

  if (activeRepos.length === 0) {
    return null;
  }

  return (
    <div>
      <SidebarSectionHeader
        title="Local"
        icon={
          <svg
            className="h-3.5 w-3.5 text-fg-faint"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        }
        isOpen={sectionOpen}
        onToggle={() => setSectionOpen((prev) => !prev)}
        trailing={
          <button
            type="button"
            onClick={() =>
              setLocalViewMode(viewMode === "changes" ? "all" : "changes")
            }
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors duration-100 ${
              viewMode === "all"
                ? "text-fg-secondary bg-fg/[0.06]"
                : "text-fg-muted hover:text-fg-secondary hover:bg-fg/[0.04]"
            }`}
            title={
              viewMode === "changes"
                ? "Show all branches"
                : "Show only working changes"
            }
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              {viewMode === "changes" ? (
                // List icon — show all
                <path d="M2 3.5h12v1H2zm0 4h12v1H2zm0 4h12v1H2z" />
              ) : (
                // Filter/funnel icon — filter to changes
                <path d="M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.25Zm3 3.5a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1 0-1.5Z" />
              )}
            </svg>
          </button>
        }
      />
      {sectionOpen && (
        <div className="pl-2">
          {viewMode === "changes" && (
            <>
              {workingTreeBranches.length === 0 && (
                <div className="px-3 py-3 text-center">
                  <p className="text-xxs text-fg-faint">
                    No uncommitted changes
                  </p>
                </div>
              )}
              {workingTreeBranches.map(({ branch, repo }) => {
                const branchKey = makeBranchKey(repo.repoPath, branch.name);
                return (
                  <LocalBranchItem
                    key={branchKey}
                    branch={branch}
                    repoPath={repo.repoPath}
                    repoName={repo.repoName}
                    defaultBranch={repo.defaultBranch}
                    viewMode="changes"
                    onActivate={onActivateLocalBranch}
                  />
                );
              })}
            </>
          )}

          {viewMode === "all" &&
            allRepos.map((repo) => {
              const collapsed =
                localRepoCollapsed[repo.repoPath] ??
                LOCAL_REPO_DEFAULT_COLLAPSED;
              const meta = repoMetadata[repo.repoPath];
              return (
                <div key={repo.repoPath} className="group/repo">
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => toggleLocalRepoCollapsed(repo.repoPath)}
                      className="flex flex-1 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg-secondary transition-colors duration-100 min-w-0"
                    >
                      <svg
                        className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      {meta?.avatarUrl && (
                        <img
                          src={meta.avatarUrl}
                          alt=""
                          className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        />
                      )}
                      <span className="truncate">{repo.repoName}</span>
                    </button>
                    <div className="flex items-center gap-0.5 pr-1.5 opacity-0 group-hover/repo:opacity-100 transition-opacity duration-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(
                            `/new?repo=${encodeURIComponent(repo.repoPath)}`,
                          );
                        }}
                        className="flex items-center justify-center w-5 h-5 rounded text-fg-muted hover:text-fg-secondary hover:bg-fg/[0.08] transition-colors duration-100"
                        title="New review for this repo"
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
                        onClick={(e) => {
                          e.stopPropagation();
                          unregisterRepo(repo.repoPath);
                        }}
                        className="flex items-center justify-center w-5 h-5 rounded text-fg-faint hover:text-status-rejected hover:bg-fg/[0.08] transition-colors duration-100"
                        title="Remove repo"
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
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {!collapsed && (
                    <div className="pl-2">
                      {repo.branches.map((branch) => {
                        const branchKey = makeBranchKey(
                          repo.repoPath,
                          branch.name,
                        );
                        return (
                          <LocalBranchItem
                            key={branchKey}
                            branch={branch}
                            repoPath={repo.repoPath}
                            defaultBranch={repo.defaultBranch}
                            viewMode="all"
                            onActivate={onActivateLocalBranch}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

interface TabRailListProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
  onNewReview: () => void;
}

function TabRailList({
  onActivateReview,
  onNewReview,
}: TabRailListProps): ReactNode {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  const [sectionCollapsed, setSectionCollapsed] = useState(false);
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  const deleteGlobalReview = useReviewStore((s) => s.deleteGlobalReview);
  const reviewSortOrder = useReviewStore((s) => s.reviewSortOrder);
  const setReviewSortOrder = useReviewStore((s) => s.setReviewSortOrder);
  const reviewDiffStats = useReviewStore((s) => s.reviewDiffStats);
  const reviewMissingRefs = useReviewStore((s) => s.reviewMissingRefs);

  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useReviewStore((s) => s.hunks);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);

  const liveProgress = useMemo(
    () => (reviewState ? computeReviewProgress(hunks, reviewState) : null),
    [hunks, reviewState],
  );

  const localActivity = useReviewStore((s) => s.localActivity);

  const sortedReviews = useMemo(() => {
    // Exclude reviews for local branches that are currently checked out
    // (current branch or worktree branches). These belong in the Local section.
    const localKeys = new Set<string>();
    for (const repo of localActivity) {
      for (const branch of repo.branches) {
        if (branch.isCurrent || branch.worktreePath != null) {
          localKeys.add(
            makeReviewKey(
              repo.repoPath,
              makeComparison(repo.defaultBranch, branch.name).key,
            ),
          );
        }
      }
    }
    const filtered = globalReviews.filter(
      (r) => !localKeys.has(makeReviewKey(r.repoPath, r.comparison.key)),
    );
    return sortReviews(filtered, reviewSortOrder, reviewDiffStats);
  }, [globalReviews, localActivity, reviewSortOrder, reviewDiffStats]);

  const handleDeleteReview = useCallback(
    (review: GlobalReviewSummary) => {
      deleteGlobalReview(review.repoPath, review.comparison);
      const active = useReviewStore.getState().activeReviewKey;
      if (
        active?.repoPath === review.repoPath &&
        active?.comparisonKey === review.comparison.key
      ) {
        navigateRef.current("/");
      }
    },
    [deleteGlobalReview],
  );

  function itemPropsFor(review: GlobalReviewSummary) {
    const meta = repoMetadata[review.repoPath];
    const key = makeReviewKey(review.repoPath, review.comparison.key);

    // For the currently-open review, override progress fields with live store state
    const isCurrentReview =
      activeReviewKey?.repoPath === review.repoPath &&
      activeReviewKey?.comparisonKey === review.comparison.key;

    const effectiveReview =
      isCurrentReview && liveProgress ? { ...review, ...liveProgress } : review;

    return {
      review: effectiveReview,
      repoName: meta?.routePrefix ?? review.repoName,
      defaultBranch: meta?.defaultBranch,
      avatarUrl: meta?.avatarUrl,
      sortOrder: reviewSortOrder,
      diffStats: reviewDiffStats[key],
      missingRefs: reviewMissingRefs[key],
      onActivate: onActivateReview,
      onDelete: handleDeleteReview,
    };
  }

  if (globalReviews.length === 0 && !globalReviewsLoading) {
    return null;
  }

  return (
    <div role="tablist">
      <SidebarSectionHeader
        title="Reviews"
        icon={
          <svg
            className="h-3.5 w-3.5 text-fg-faint"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        }
        isOpen={!sectionCollapsed}
        onToggle={() => setSectionCollapsed((prev) => !prev)}
        trailing={
          <>
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
              className="flex items-center justify-center w-5 h-5 rounded
                         text-fg-muted hover:text-fg-secondary hover:bg-fg/[0.08]
                         transition-colors duration-100"
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
          </>
        }
      />

      {!sectionCollapsed && (
        <div className="pl-2">
          {globalReviewsLoading && globalReviews.length === 0 && (
            <div className="space-y-2 px-2 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse space-y-1">
                  <div className="h-2.5 w-16 rounded bg-fg/[0.06]" />
                  <div className="h-8 rounded bg-fg/[0.04]" />
                </div>
              ))}
            </div>
          )}

          {sortedReviews.map((review) => {
            const key = makeReviewKey(review.repoPath, review.comparison.key);
            return <TabRailItem key={key} {...itemPropsFor(review)} />;
          })}
        </div>
      )}
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
          <div className="shrink-0 px-2 py-2 flex items-center justify-end">
            <button
              type="button"
              onClick={toggleTabRail}
              className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md
                         hover:bg-fg/[0.08] transition-colors duration-100
                         text-fg-muted hover:text-fg-secondary"
              aria-label="Hide sidebar"
            >
              <SidebarPanelIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <TabRailList
              onActivateReview={onActivateReview}
              onNewReview={handleAddReview}
            />
            <LocalSection onActivateLocalBranch={onActivateLocalBranch} />
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
