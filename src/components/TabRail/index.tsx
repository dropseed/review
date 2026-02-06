import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useReviewStore } from "../../stores";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { TabRailItem } from "./TabRailItem";
import { ComparisonPickerModal } from "../ComparisonPickerModal";
import type { GlobalReviewSummary } from "../../types";

interface TabRailProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
}

export function TabRail({ onActivateReview }: TabRailProps) {
  const navigate = useNavigate();
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  const reviewDiffStats = useReviewStore((s) => s.reviewDiffStats);
  const deleteGlobalReview = useReviewStore((s) => s.deleteGlobalReview);
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);

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

  const handleDeleteReview = useCallback(
    (review: GlobalReviewSummary) => {
      deleteGlobalReview(review.repoPath, review.comparison);
      if (
        activeReviewKey?.repoPath === review.repoPath &&
        activeReviewKey?.comparisonKey === review.comparison.key
      ) {
        navigate("/");
      }
    },
    [deleteGlobalReview, activeReviewKey, navigate],
  );

  const handleAddReview = useCallback(() => {
    setComparisonPickerRepoPath(null);
    setComparisonPickerOpen(true);
  }, [setComparisonPickerRepoPath, setComparisonPickerOpen]);

  const handleCloseModal = useCallback(() => {
    setComparisonPickerOpen(false);
    setComparisonPickerRepoPath(null);
  }, [setComparisonPickerOpen, setComparisonPickerRepoPath]);

  return (
    <div className="relative flex shrink-0" data-tauri-drag-region>
      <nav
        className={`tab-rail flex h-full shrink-0 flex-col
                   bg-stone-950/80 backdrop-blur-md border-r border-white/[0.06] overflow-hidden
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
          {/* Header — matches h-12 main header */}
          <div
            className="shrink-0 flex items-center justify-between h-12 pl-3.5 pr-3"
            data-tauri-drag-region
          >
            <span className="text-[10px] font-medium uppercase tracking-widest text-stone-500">
              Reviews
            </span>
            <button
              type="button"
              onClick={handleAddReview}
              className="p-1 rounded text-stone-500 hover:text-stone-300 hover:bg-white/[0.08]
                         focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50
                         transition-colors duration-100"
              aria-label="New review"
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

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
                  Press &ldquo;+&rdquo; to start
                </p>
              </div>
            )}

            {globalReviews.map((review) => {
              const meta = repoMetadata[review.repoPath];
              const displayName = meta?.routePrefix ?? review.repoName;
              const isActive =
                activeReviewKey?.repoPath === review.repoPath &&
                activeReviewKey?.comparisonKey === review.comparison.key;
              const statsKey = `${review.repoPath}:${review.comparison.key}`;
              return (
                <TabRailItem
                  key={statsKey}
                  review={review}
                  repoName={displayName}
                  defaultBranch={meta?.defaultBranch}
                  isActive={isActive}
                  diffStats={reviewDiffStats[statsKey]}
                  avatarUrl={meta?.avatarUrl}
                  onActivate={() => onActivateReview(review)}
                  onDelete={() => handleDeleteReview(review)}
                />
              );
            })}
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

      <ComparisonPickerModal
        isOpen={comparisonPickerOpen}
        onClose={handleCloseModal}
        prefilledRepoPath={comparisonPickerRepoPath}
      />
    </div>
  );
}
