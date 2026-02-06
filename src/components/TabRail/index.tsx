import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useReviewStore } from "../../stores";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { TabRailItem } from "./TabRailItem";
import { AddReviewPopover } from "./AddReviewPopover";

interface TabRailProps {
  onOpenRepo: () => Promise<void>;
  onSelectRepo: (path: string) => void;
}

export function TabRail({ onOpenRepo, onSelectRepo }: TabRailProps) {
  const navigate = useNavigate();
  const openReviews = useReviewStore((s) => s.openReviews);
  const activeTabIndex = useReviewStore((s) => s.activeTabIndex);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);
  const removeOpenReview = useReviewStore((s) => s.removeOpenReview);
  const setRepoPath = useReviewStore((s) => s.setRepoPath);
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);

  const { sidebarWidth, isResizing, handleResizeStart } = useSidebarResize({
    sidebarPosition: "left",
    initialWidth: 14, // ~210px
    minWidth: 10, // ~150px
    maxWidth: 24, // ~360px
  });

  const [addPopoverOpen, setAddPopoverOpen] = useState(false);

  const handleActivateTab = useCallback(
    (index: number) => {
      const review = openReviews[index];
      if (!review) return;

      setActiveTab(index);

      // Navigate to the review's URL
      navigate(`/${review.routePrefix}/review/${review.comparison.key}`);

      // If repo changed, update the repo path
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
        // No more tabs — go to welcome
        navigate("/");
      } else {
        // The removeOpenReview already adjusts activeTabIndex,
        // but we need to navigate to the new active tab
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

  // Placeholder for comparison switching (right-click context menu)
  const handleSwitchComparison = useCallback((_index: number) => {
    // TODO: open a comparison picker popover for this tab
  }, []);

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
                onSwitchComparison={() => handleSwitchComparison(index)}
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
            <AddReviewPopover
              isOpen={addPopoverOpen}
              onOpenChange={setAddPopoverOpen}
              onOpenRepo={onOpenRepo}
              onSelectRepo={onSelectRepo}
            />
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
    </div>
  );
}
