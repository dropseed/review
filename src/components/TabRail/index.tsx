import {
  lazy,
  Suspense,
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
import type { GlobalReviewSummary, DiffShortStat } from "../../types";
import type { ReviewSortOrder } from "../../stores/slices/preferencesSlice";

const ComparisonPickerModal = lazy(() =>
  import("../modals/ComparisonPickerModal").then((m) => ({
    default: m.ComparisonPickerModal,
  })),
);
const SettingsModal = lazy(() =>
  import("../modals/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);

const GITHUB_REPO_URL = "https://github.com/dropseed/review";

const SORT_OPTIONS: [ReviewSortOrder, string][] = [
  ["updated", "Last updated"],
  ["repo", "Repository"],
  ["size", "Size"],
];

/** Derive the unique key used for stats lookup, active state, etc. */
function reviewKey(review: GlobalReviewSummary): string {
  return `${review.repoPath}:${review.comparison.key}`;
}

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
  const stats = diffStats[reviewKey(review)];
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

/** Sort menu button + dropdown. */
function SortMenu({
  sortOrder,
  onSetSortOrder,
}: {
  sortOrder: ReviewSortOrder;
  onSetSortOrder: (order: ReviewSortOrder) => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="p-0.5 rounded text-stone-600 hover:text-stone-400 hover:bg-white/[0.08]
                   transition-colors duration-100"
        aria-label="Sort reviews"
        aria-expanded={open}
        aria-haspopup="true"
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
          <path d="M3 6h18" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </svg>
      </button>
      {open && (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            role="button"
            tabIndex={0}
            aria-label="Close menu"
          />
          <div
            className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md bg-stone-900 border border-white/[0.08] py-1 shadow-xl"
            role="menu"
          >
            {SORT_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSetSortOrder(value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors duration-100
                  ${
                    sortOrder === value
                      ? "text-stone-200 bg-white/[0.06]"
                      : "text-stone-400 hover:text-stone-200 hover:bg-white/[0.04]"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
}: FooterVersionInfoProps) {
  if (updateAvailable) {
    return (
      <button
        type="button"
        onClick={installUpdate}
        disabled={installing}
        className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors duration-100 disabled:opacity-50"
      >
        {installing ? (
          <>
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-stone-600 border-t-emerald-400 animate-spin" />
            Installing…
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
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
        className="text-[10px] tabular-nums text-stone-600 hover:text-stone-400 transition-colors duration-100"
      >
        v{appVersion}
      </button>
    );
  }

  return null;
}

// --- Review list (owns the data-heavy store subscriptions) ---

interface TabRailListProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
}

function TabRailList({ onActivateReview }: TabRailListProps) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  const deleteGlobalReview = useReviewStore((s) => s.deleteGlobalReview);
  const reviewSortOrder = useReviewStore((s) => s.reviewSortOrder);
  const setReviewSortOrder = useReviewStore((s) => s.setReviewSortOrder);
  const inactiveReviewSortOrder = useReviewStore(
    (s) => s.inactiveReviewSortOrder,
  );
  const setInactiveReviewSortOrder = useReviewStore(
    (s) => s.setInactiveReviewSortOrder,
  );
  const reviewDiffStats = useReviewStore((s) => s.reviewDiffStats);
  const reviewActiveState = useReviewStore((s) => s.reviewActiveState);

  // Live progress for the current review — derived directly from store state
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useReviewStore((s) => s.hunks);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);

  const liveProgress = useMemo(
    () => (reviewState ? computeReviewProgress(hunks, reviewState) : null),
    [hunks, reviewState],
  );

  const [inactiveCollapsed, setInactiveCollapsed] = useState(true);

  // Split into active / inactive
  const { activeReviews, inactiveReviews } = useMemo(() => {
    const active: GlobalReviewSummary[] = [];
    const inactive: GlobalReviewSummary[] = [];
    for (const review of globalReviews) {
      const key = reviewKey(review);
      // Default to active if state is unknown (loading / not yet checked)
      const isActive = reviewActiveState[key] ?? true;
      if (isActive) {
        active.push(review);
      } else {
        inactive.push(review);
      }
    }
    return { activeReviews: active, inactiveReviews: inactive };
  }, [globalReviews, reviewActiveState]);

  const sortedActive = useMemo(
    () => sortReviews(activeReviews, reviewSortOrder, reviewDiffStats),
    [activeReviews, reviewSortOrder, reviewDiffStats],
  );

  const sortedInactive = useMemo(
    () =>
      sortReviews(inactiveReviews, inactiveReviewSortOrder, reviewDiffStats),
    [inactiveReviews, inactiveReviewSortOrder, reviewDiffStats],
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

  function itemPropsFor(
    review: GlobalReviewSummary,
    isInactive: boolean,
    currentSortOrder: ReviewSortOrder,
  ) {
    const meta = repoMetadata[review.repoPath];
    const key = reviewKey(review);

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
      isInactive,
      avatarUrl: meta?.avatarUrl,
      sortOrder: currentSortOrder,
      diffStats: reviewDiffStats[key],
      onActivate: onActivateReview,
      onDelete: handleDeleteReview,
    };
  }

  return (
    <div
      className="flex-1 overflow-y-auto scrollbar-thin px-1.5 py-1"
      role="tablist"
    >
      {globalReviewsLoading && globalReviews.length === 0 && (
        <div className="space-y-2 px-2 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-1">
              <div className="h-2.5 w-16 rounded bg-white/[0.06]" />
              <div className="h-8 rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      )}

      {!globalReviewsLoading && globalReviews.length === 0 && (
        <div className="px-2 py-8 text-center">
          <svg
            className="h-6 w-6 mx-auto mb-2 text-stone-600"
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
          <p className="text-2xs text-stone-500">No reviews yet</p>
          <p className="text-xxs text-stone-600 mt-1">
            Click &ldquo;New review&rdquo; to start
          </p>
        </div>
      )}

      {/* Active section */}
      {sortedActive.length > 0 && (
        <>
          <div className="px-2 pt-1 pb-0.5 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-stone-600">
              Active
            </span>
            <SortMenu
              sortOrder={reviewSortOrder}
              onSetSortOrder={setReviewSortOrder}
            />
          </div>
          {sortedActive.map((review) => {
            const key = reviewKey(review);
            return (
              <TabRailItem
                key={key}
                {...itemPropsFor(review, false, reviewSortOrder)}
              />
            );
          })}
        </>
      )}

      {/* Inactive section */}
      {sortedInactive.length > 0 && (
        <>
          {sortedActive.length > 0 && <div className="h-2" />}
          <div className="px-2 pt-1 pb-0.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setInactiveCollapsed((prev) => !prev)}
              className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-stone-600 hover:text-stone-400 transition-colors duration-100"
            >
              <svg
                className={`h-2.5 w-2.5 transition-transform duration-150 ${inactiveCollapsed ? "-rotate-90" : ""}`}
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
              Inactive
              <span className="ml-0.5 text-[9px] tabular-nums text-stone-700">
                {sortedInactive.length}
              </span>
            </button>
            {!inactiveCollapsed && (
              <SortMenu
                sortOrder={inactiveReviewSortOrder}
                onSetSortOrder={setInactiveReviewSortOrder}
              />
            )}
          </div>
          {!inactiveCollapsed &&
            sortedInactive.map((review) => {
              const key = reviewKey(review);
              return (
                <TabRailItem
                  key={key}
                  {...itemPropsFor(review, true, inactiveReviewSortOrder)}
                />
              );
            })}
        </>
      )}
    </div>
  );
}

// --- Shell (header, footer, resize — no data subscriptions) ---

interface TabRailProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
}

export const TabRail = memo(function TabRail({
  onActivateReview,
}: TabRailProps) {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  const [showSettings, setShowSettings] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const { updateAvailable, installing, installUpdate } = useAutoUpdater();

  // Listen for menu:open-settings globally (TabRail is always mounted)
  useEffect(() => {
    const platform = getPlatformServices();
    return platform.menuEvents.on("menu:open-settings", () =>
      setShowSettings(true),
    );
  }, []);

  const comparisonPickerOpen = useReviewStore((s) => s.comparisonPickerOpen);
  const setComparisonPickerOpen = useReviewStore(
    (s) => s.setComparisonPickerOpen,
  );
  const comparisonPickerRepoPath = useReviewStore(
    (s) => s.comparisonPickerRepoPath,
  );
  const setComparisonPickerRepoPath = useReviewStore(
    (s) => s.setComparisonPickerRepoPath,
  );

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
    setComparisonPickerRepoPath(null);
    setComparisonPickerOpen(true);
  }, [setComparisonPickerRepoPath, setComparisonPickerOpen]);

  const handleCloseModal = useCallback(() => {
    setComparisonPickerOpen(false);
    setComparisonPickerRepoPath(null);
  }, [setComparisonPickerOpen, setComparisonPickerRepoPath]);

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
                   bg-stone-950 border-r border-white/[0.06] overflow-hidden
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
          {/* Top bar: new review + collapse */}
          <div className="shrink-0 px-1.5 py-2.5 flex items-center gap-1 shadow-[0_1px_0_0_rgba(255,255,255,0.04)]">
            <button
              type="button"
              onClick={handleAddReview}
              className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5
                         text-[11px] font-medium text-stone-400 hover:text-stone-200
                         hover:bg-white/[0.08] transition-colors duration-100
                         focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50"
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
              New review
            </button>
            <button
              type="button"
              onClick={toggleTabRail}
              className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md
                         hover:bg-white/[0.08] transition-colors duration-100
                         text-stone-500 hover:text-stone-300"
              aria-label="Hide sidebar"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </div>

          <TabRailList onActivateReview={onActivateReview} />

          {/* Footer */}
          <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="p-1.5 rounded text-stone-600 hover:text-stone-400 hover:bg-white/[0.06]
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
                  className="p-1.5 rounded text-stone-600 hover:text-stone-400 hover:bg-white/[0.06]
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
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onMouseDown={handleResizeStart}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize
                       hover:bg-amber-500/50 active:bg-amber-500"
          />
        )}
      </nav>

      {comparisonPickerOpen && (
        <Suspense fallback={null}>
          <ComparisonPickerModal
            isOpen={comparisonPickerOpen}
            onClose={handleCloseModal}
            prefilledRepoPath={comparisonPickerRepoPath}
          />
        </Suspense>
      )}

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
          />
        </Suspense>
      )}
    </div>
  );
});
