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
import { type GlobalReviewSummary } from "../../types";
import type { ReviewSortOrder } from "../../stores/slices/preferencesSlice";
import { SidebarPanelIcon } from "../ui/icons";
import { SidebarResizeHandle } from "../ui/sidebar-resize-handle";
import { Spinner } from "../ui/spinner";
import { LspStatusIndicator } from "../LspStatusIndicator";
import { SortMenu } from "../FilesPanel/SortMenu";
import { LocalBranchItem } from "./LocalBranchItem";
import { makeReviewKey } from "../../stores/slices/groupingSlice";

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
  buildRepoGroups,
  type SidebarEntry,
  type RepoGroup,
  type BaseGroup,
} from "../../utils/sidebar-ordering";

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
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsByKey = useReviewStore((s) => s.globalReviewsByKey);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  const localActivity = useReviewStore((s) => s.localActivity);
  const localActivityLoading = useReviewStore((s) => s.localActivityLoading);
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

  const repoGroups = useMemo(
    () =>
      buildRepoGroups(
        localActivity,
        globalReviews,
        globalReviewsByKey,
        reviewSortOrder,
        reviewDiffStats,
      ),
    [
      localActivity,
      globalReviews,
      globalReviewsByKey,
      reviewSortOrder,
      reviewDiffStats,
    ],
  );

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

  function reviewItemPropsFor(review: GlobalReviewSummary) {
    const meta = repoMetadata[review.repoPath];
    const key = makeReviewKey(review.repoPath, review.comparison.key);

    const isCurrentReview =
      activeReviewKey?.repoPath === review.repoPath &&
      activeReviewKey?.comparisonKey === review.comparison.key;

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

  function renderEntry(entry: SidebarEntry) {
    if (entry.kind === "review") {
      return (
        <TabRailItem
          key={entry.reviewKey}
          {...reviewItemPropsFor(entry.review)}
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

  const [showCleanRepos, setShowCleanRepos] = useState(false);

  const totalItems = repoGroups.reduce((n, g) => n + g.items.length, 0);

  const isEmpty =
    totalItems === 0 && !globalReviewsLoading && !localActivityLoading;

  if (isEmpty) {
    return null;
  }

  const isLoading =
    globalReviewsLoading &&
    globalReviews.length === 0 &&
    localActivity.length === 0;

  // Split repos into those with changes and those without
  const reposWithChanges = repoGroups.filter((g) => g.hasChanges);
  const reposWithoutChanges = repoGroups.filter((g) => !g.hasChanges);
  const hiddenRepoCount = reposWithoutChanges.length;

  // Show all repos when filter is off or there are no repos with changes
  const visibleRepos =
    showCleanRepos || reposWithChanges.length === 0
      ? repoGroups
      : reposWithChanges;

  return (
    <div role="tablist" className="pb-1">
      {isLoading && (
        <div className="space-y-2 px-2 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-1">
              <div className="h-2.5 w-16 rounded bg-fg/[0.06]" />
              <div className="h-8 rounded bg-fg/[0.04]" />
            </div>
          ))}
        </div>
      )}

      {visibleRepos.map((group) => {
        const meta = repoMetadata[group.repoPath];
        return (
          <RepoGroupHeader
            key={group.repoPath}
            group={group}
            avatarUrl={meta?.avatarUrl}
            displayName={meta?.routePrefix ?? group.repoName}
            renderEntry={renderEntry}
          />
        );
      })}

      {/* Show "+N repos" button when clean repos are hidden */}
      {!showCleanRepos &&
        hiddenRepoCount > 0 &&
        reposWithChanges.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCleanRepos(true)}
            className="w-full text-center py-1.5 text-[10px] font-medium text-fg-faint
                     hover:text-fg-secondary transition-colors"
          >
            +{hiddenRepoCount} repo{hiddenRepoCount !== 1 ? "s" : ""}
          </button>
        )}

      {/* Show "changes only" toggle when clean repos are visible */}
      {showCleanRepos && hiddenRepoCount > 0 && reposWithChanges.length > 0 && (
        <button
          type="button"
          onClick={() => setShowCleanRepos(false)}
          className="w-full text-center py-1.5 text-[10px] font-medium text-fg-faint
                     hover:text-fg-secondary transition-colors"
        >
          changes only
        </button>
      )}
    </div>
  );
}

/** Render a base group with a subtle label and tree-line connector. */
function BaseGroupSection({
  baseGroup,
  renderEntry,
  showAll,
}: {
  baseGroup: BaseGroup;
  renderEntry: (entry: SidebarEntry) => ReactNode;
  showAll: boolean;
}) {
  const visibleItems = showAll
    ? baseGroup.items
    : baseGroup.items.filter((e) => e.kind !== "branch");

  if (visibleItems.length === 0) return null;

  return (
    <div className="mt-1.5">
      <div className="px-3 py-0.5 flex items-center gap-1.5">
        <span className="h-px flex-1 bg-edge/20" />
        <span className="text-[9px] text-fg-faint/50 tracking-wider shrink-0">
          {baseGroup.base}
        </span>
        <span className="h-px flex-1 bg-edge/20" />
      </div>
      <div className="ml-3 border-l border-l-fg/[0.06] pl-0.5">
        {visibleItems.map(renderEntry)}
      </div>
    </div>
  );
}

/** Repo group with avatar, name, and per-repo expand toggle for plain branches. */
function RepoGroupHeader({
  group,
  avatarUrl,
  displayName,
  renderEntry,
}: {
  group: RepoGroup;
  avatarUrl?: string | null;
  displayName: string;
  renderEntry: (entry: SidebarEntry) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const hiddenCount = group.items.filter((e) => e.kind === "branch").length;

  return (
    <div className="mt-1.5 first:mt-0 border-t border-t-edge/30 first:border-t-0 pt-1.5">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 mb-0.5
                   hover:bg-fg/[0.04] transition-colors duration-100 rounded-sm"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-4 w-4 rounded-sm shrink-0 opacity-70"
          />
        ) : (
          <span className="h-4 w-4 rounded-sm shrink-0 bg-fg/[0.10]" />
        )}
        <span className="flex-1 text-[11px] font-semibold text-fg-secondary truncate">
          {displayName}
        </span>
        {hiddenCount > 0 && !collapsed && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowAll((v) => !v);
            }}
            className="text-[10px] tabular-nums text-fg-faint hover:text-fg-secondary
                       transition-colors px-0.5"
          >
            {showAll ? "active" : `+${hiddenCount}`}
          </span>
        )}
      </button>
      {!collapsed && (
        <div>
          {group.baseGroups.length > 1
            ? group.baseGroups.map((bg) => (
                <BaseGroupSection
                  key={bg.base}
                  baseGroup={bg}
                  renderEntry={renderEntry}
                  showAll={showAll}
                />
              ))
            : (showAll
                ? group.items
                : group.items.filter((e) => e.kind !== "branch")
              ).map(renderEntry)}
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
      <span className="flex-1 pl-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
        Reviews
      </span>
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

/** Lightweight section header with optional trailing actions. */
function SidebarSection({
  label,
  actions,
  children,
}: {
  label: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-t-edge/40">
      <div className="flex items-center">
        <span className="flex-1 pl-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
          {label}
        </span>
        {actions && (
          <div className="flex items-center gap-0.5 pr-1">{actions}</div>
        )}
      </div>
      <div className="pb-1">{children}</div>
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
