import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useReviewStore } from "../../stores";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { getPlatformServices } from "../../platform";
import { TabRailItem } from "./TabRailItem";
import { SortableTabRailItem } from "./SortableTabRailItem";
import { ComparisonPickerModal } from "../ComparisonPickerModal";
import { SettingsModal } from "../SettingsModal";
import type { GlobalReviewSummary } from "../../types";

const GITHUB_REPO_URL = "https://github.com/dropseed/review";

/** Derive the unique key used for pinning, stats lookup, etc. */
function reviewKey(review: GlobalReviewSummary): string {
  return `${review.repoPath}:${review.comparison.key}`;
}

interface TabRailProps {
  onActivateReview: (review: GlobalReviewSummary) => void;
}

export function TabRail({ onActivateReview }: TabRailProps) {
  const navigate = useNavigate();
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  const deleteGlobalReview = useReviewStore((s) => s.deleteGlobalReview);
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const pinnedReviewKeys = useReviewStore((s) => s.pinnedReviewKeys);
  const pinReview = useReviewStore((s) => s.pinReview);
  const unpinReview = useReviewStore((s) => s.unpinReview);
  const reorderPinnedReviews = useReviewStore((s) => s.reorderPinnedReviews);

  const [showSettings, setShowSettings] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Split reviews into pinned (ordered by pinnedReviewKeys) and unpinned
  const pinnedKeySet = useMemo(
    () => new Set(pinnedReviewKeys),
    [pinnedReviewKeys],
  );

  const reviewsByKey = useMemo(() => {
    const map = new Map<string, GlobalReviewSummary>();
    for (const review of globalReviews) {
      map.set(reviewKey(review), review);
    }
    return map;
  }, [globalReviews]);

  const pinnedReviews = useMemo(
    () =>
      pinnedReviewKeys
        .map((key) => ({ key, review: reviewsByKey.get(key) }))
        .filter(
          (item): item is { key: string; review: GlobalReviewSummary } =>
            item.review !== undefined,
        ),
    [pinnedReviewKeys, reviewsByKey],
  );

  const unpinnedReviews = useMemo(
    () => globalReviews.filter((r) => !pinnedKeySet.has(reviewKey(r))),
    [globalReviews, pinnedKeySet],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = pinnedReviewKeys.indexOf(active.id as string);
        const newIndex = pinnedReviewKeys.indexOf(over.id as string);
        reorderPinnedReviews(arrayMove(pinnedReviewKeys, oldIndex, newIndex));
      }
    },
    [pinnedReviewKeys, reorderPinnedReviews],
  );

  const handleDeleteReview = useCallback(
    (review: GlobalReviewSummary) => {
      unpinReview(reviewKey(review));
      deleteGlobalReview(review.repoPath, review.comparison);
      if (
        activeReviewKey?.repoPath === review.repoPath &&
        activeReviewKey?.comparisonKey === review.comparison.key
      ) {
        navigate("/");
      }
    },
    [deleteGlobalReview, unpinReview, activeReviewKey, navigate],
  );

  const handleTogglePin = useCallback(
    (review: GlobalReviewSummary) => {
      const key = reviewKey(review);
      if (pinnedKeySet.has(key)) {
        unpinReview(key);
      } else {
        pinReview(key);
      }
    },
    [pinnedKeySet, pinReview, unpinReview],
  );

  const handleAddReview = useCallback(() => {
    setComparisonPickerRepoPath(null);
    setComparisonPickerOpen(true);
  }, [setComparisonPickerRepoPath, setComparisonPickerOpen]);

  const handleCloseModal = useCallback(() => {
    setComparisonPickerOpen(false);
    setComparisonPickerRepoPath(null);
  }, [setComparisonPickerOpen, setComparisonPickerRepoPath]);

  /** Build the common TabRailItem props for a review. */
  function itemPropsFor(review: GlobalReviewSummary, isPinned: boolean) {
    const meta = repoMetadata[review.repoPath];
    return {
      review,
      repoName: meta?.routePrefix ?? review.repoName,
      defaultBranch: meta?.defaultBranch,
      isActive:
        activeReviewKey?.repoPath === review.repoPath &&
        activeReviewKey?.comparisonKey === review.comparison.key,
      isPinned,
      avatarUrl: meta?.avatarUrl,
      onActivate: () => onActivateReview(review),
      onDelete: () => handleDeleteReview(review),
      onTogglePin: () => handleTogglePin(review),
    };
  }

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

            {/* Pinned section */}
            {pinnedReviews.length > 0 && (
              <>
                <div className="px-2 pt-1 pb-0.5">
                  <span className="text-[9px] uppercase tracking-wider text-stone-600">
                    Pinned
                  </span>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={pinnedReviews.map((p) => p.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    {pinnedReviews.map(({ key, review }) => (
                      <SortableTabRailItem
                        key={key}
                        id={key}
                        {...itemPropsFor(review, true)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                <div className="mx-1.5 my-1 h-px bg-white/[0.06]" />
              </>
            )}

            {/* Unpinned section */}
            {unpinnedReviews.map((review) => {
              const key = reviewKey(review);
              return <TabRailItem key={key} {...itemPropsFor(review, false)} />;
            })}
          </div>

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
              {appVersion && (
                <button
                  type="button"
                  onClick={handleOpenRelease}
                  className="text-[10px] tabular-nums text-stone-600 hover:text-stone-400 transition-colors duration-100"
                >
                  v{appVersion}
                </button>
              )}
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

      <ComparisonPickerModal
        isOpen={comparisonPickerOpen}
        onClose={handleCloseModal}
        prefilledRepoPath={comparisonPickerRepoPath}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
