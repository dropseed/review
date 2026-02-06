import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useReviewStore } from "../../stores";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { TabRailItem } from "./TabRailItem";
import { ComparisonPickerModal } from "../ComparisonPickerModal";

interface TabRailProps {
  onOpenRepo: () => Promise<void>;
}

export function TabRail({ onOpenRepo }: TabRailProps) {
  const navigate = useNavigate();
  const openReviews = useReviewStore((s) => s.openReviews);
  const activeTabIndex = useReviewStore((s) => s.activeTabIndex);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);
  const removeOpenReview = useReviewStore((s) => s.removeOpenReview);
  const setRepoPath = useReviewStore((s) => s.setRepoPath);
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

  const handleActivateTab = useCallback(
    (index: number) => {
      const review = openReviews[index];
      if (!review) return;

      setActiveTab(index);
      navigate(`/${review.routePrefix}/review/${review.comparison.key}`);

      const currentRepoPath = useReviewStore.getState().repoPath;
      if (review.repoPath !== currentRepoPath) {
        setRepoPath(review.repoPath);
      }
    },
    [openReviews, setActiveTab, navigate, setRepoPath],
  );

  const handleCloseTab = useCallback(
    (index: number) => {
      const isLast = openReviews.length === 1;
      removeOpenReview(index);

      if (isLast) {
        navigate("/");
      } else {
        const state = useReviewStore.getState();
        const newIndex = state.activeTabIndex;
        if (newIndex !== null && state.openReviews[newIndex]) {
          const review = state.openReviews[newIndex];
          navigate(`/${review.routePrefix}/review/${review.comparison.key}`);
          if (review.repoPath !== state.repoPath) {
            setRepoPath(review.repoPath);
          }
        }
      }
    },
    [openReviews.length, removeOpenReview, navigate, setRepoPath],
  );

  // Context menu: "New Review in This Repo..." — pre-fill with that tab's repo
  const handleNewReviewInRepo = useCallback(
    (repoPath: string) => {
      setComparisonPickerRepoPath(repoPath);
      setComparisonPickerOpen(true);
    },
    [setComparisonPickerRepoPath, setComparisonPickerOpen],
  );

  // "+" button: open modal with no pre-filled repo (step 1)
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
      {/* Rail panel */}
      <nav
        className={`tab-rail flex h-full shrink-0 flex-col bg-stone-900/70
                   backdrop-blur-sm border-r border-stone-800/60 overflow-hidden
                   ${isResizing ? "" : "transition-[width,opacity] duration-200 ease-out"}`}
        style={{
          width: collapsed ? 0 : `${sidebarWidth}rem`,
          opacity: collapsed ? 0 : 1,
        }}
        aria-label="Open reviews"
        aria-hidden={collapsed}
      >
        <div
          className="flex flex-col h-full min-w-0"
          style={{ width: `${sidebarWidth}rem` }}
        >
          {/* Top padding for macOS traffic lights */}
          <div className="h-12 shrink-0" data-tauri-drag-region />

          {/* Scrollable tab list */}
          <div
            className="flex-1 overflow-y-auto scrollbar-thin px-1.5 py-1"
            role="tablist"
          >
            {openReviews.map((review, index) => (
              <TabRailItem
                key={`${review.repoPath}:${review.comparison.key}`}
                review={review}
                isActive={index === activeTabIndex}
                onActivate={() => handleActivateTab(index)}
                onClose={() => handleCloseTab(index)}
                onNewReviewInRepo={() => handleNewReviewInRepo(review.repoPath)}
              />
            ))}

            {openReviews.length === 0 && (
              <div className="px-2 py-4 text-center">
                <p className="text-2xs text-stone-600">No reviews open</p>
              </div>
            )}
          </div>

          {/* Add button */}
          <div className="shrink-0 px-1.5 pb-1.5">
            <button
              type="button"
              onClick={handleAddReview}
              className="flex items-center justify-center w-full py-2 rounded-lg
                         text-stone-500 hover:text-stone-300 hover:bg-stone-800/50
                         transition-colors duration-100"
              aria-label="Add review"
            >
              <svg
                className="h-4 w-4"
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
        </div>

        {/* Resize handle (right edge) */}
        {!collapsed && (
          <div
            onMouseDown={handleResizeStart}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize
                       hover:bg-amber-500/50 active:bg-amber-500"
          />
        )}
      </nav>

      {/* Comparison Picker Modal */}
      <ComparisonPickerModal
        isOpen={comparisonPickerOpen}
        onClose={handleCloseModal}
        prefilledRepoPath={comparisonPickerRepoPath}
        onOpenRepo={onOpenRepo}
      />
    </div>
  );
}
