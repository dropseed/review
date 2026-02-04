import { useState, useCallback, memo } from "react";
import type { Comparison, ReviewSummary } from "../../types";
import { useSidebarData } from "./SidebarDataContext";
import { useReviewStore } from "../../stores";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffSecs < 60) return rtf.format(-diffSecs, "second");
  if (diffMins < 60) return rtf.format(-diffMins, "minute");
  if (diffHours < 24) return rtf.format(-diffHours, "hour");
  if (diffDays < 7) return rtf.format(-diffDays, "day");
  if (diffDays < 30) return rtf.format(-Math.floor(diffDays / 7), "week");
  return date.toLocaleDateString();
}

function formatComparison(comparison: Comparison): string {
  let compareRef = comparison.new;
  if (comparison.stagedOnly) {
    compareRef = "Staged";
  } else if (comparison.workingTree) {
    compareRef = "Working Tree";
  }
  return `${comparison.old}..${compareRef}`;
}

interface ReviewCardProps {
  review: ReviewSummary;
  index: number;
  isDeleting: boolean;
  prefersReducedMotion: boolean;
  onSelect: () => void;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}

const ReviewCard = memo(function ReviewCard({
  review,
  index,
  isDeleting,
  prefersReducedMotion,
  onSelect,
  onDeleteClick,
  onDeleteConfirm,
  onDeleteCancel,
}: ReviewCardProps) {
  const progress =
    review.totalHunks > 0
      ? Math.round((review.reviewedHunks / review.totalHunks) * 100)
      : 0;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    [onSelect],
  );

  const isPr = !!review.comparison.githubPr;
  const progressWidth = progress > 0 ? Math.max(progress, 3) : 0;

  return (
    <article
      className={`group relative rounded-lg border border-stone-800/60 bg-stone-900/50
                 transition-all duration-150
                 hover:border-stone-700/80 hover:bg-stone-900/80
                 ${prefersReducedMotion ? "" : "animate-fade-in"}`}
      style={
        prefersReducedMotion ? undefined : { animationDelay: `${index * 40}ms` }
      }
    >
      <button
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        className="w-full p-3 text-left rounded-lg
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50"
        aria-label={`Open review ${formatComparison(review.comparison)}, ${progress}% complete`}
      >
        {/* Row 1: Comparison display */}
        <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
          {isPr ? (
            <>
              <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-green-500/15 text-green-400">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                </svg>
              </span>
              <span className="text-xs text-green-400 font-medium shrink-0">
                #{review.comparison.githubPr!.number}
              </span>
              <span className="text-sm text-stone-300 truncate">
                {review.comparison.githubPr!.title}
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-xs text-stone-400 shrink-0">
                {review.comparison.old}
              </span>
              <span className="text-stone-600 text-xs shrink-0">..</span>
              <span
                className={`font-mono text-xs truncate ${
                  review.comparison.workingTree
                    ? "text-green-400"
                    : review.comparison.stagedOnly
                      ? "text-green-500"
                      : "text-stone-300"
                }`}
              >
                {review.comparison.workingTree
                  ? "Working Tree"
                  : review.comparison.stagedOnly
                    ? "Staged"
                    : review.comparison.new}
              </span>
            </>
          )}
        </div>

        {/* Row 2: Progress bar + stats */}
        {review.totalHunks > 0 && (
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="flex-1 h-1 overflow-hidden rounded-full bg-stone-800/80"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-sage-500 to-sage-400 transition-[width] duration-300"
                style={{ width: `${progressWidth}%` }}
              />
            </div>
            <span className="text-xs text-stone-500 whitespace-nowrap">
              {review.reviewedHunks} / {review.totalHunks}
            </span>
          </div>
        )}

        {/* Row 3: Time */}
        <time
          dateTime={review.updatedAt}
          className="text-2xs text-stone-600 block"
        >
          {formatRelativeTime(review.updatedAt)}
        </time>
      </button>

      {/* Delete button - top right */}
      <div className="absolute top-2 right-2">
        {isDeleting ? (
          <div
            className="flex items-center gap-1 bg-stone-900/95 rounded px-1 py-0.5"
            role="group"
            aria-label="Confirm deletion"
          >
            <button
              onClick={onDeleteCancel}
              className="rounded px-1.5 py-0.5 text-2xs text-stone-400
                         hover:bg-stone-800
                         focus:outline-none focus:ring-1 focus:ring-stone-500/50"
            >
              Cancel
            </button>
            <button
              onClick={onDeleteConfirm}
              className="rounded px-1.5 py-0.5 text-2xs font-medium text-red-400 bg-red-500/10
                         hover:bg-red-500/20
                         focus:outline-none focus:ring-1 focus:ring-red-500/50"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick();
            }}
            className="rounded p-0.5 text-stone-600
                       opacity-0 transition-opacity duration-100
                       hover:text-stone-400 hover:bg-stone-800/80
                       group-hover:opacity-100
                       focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-stone-500/50"
            aria-label={`Delete ${formatComparison(review.comparison)}`}
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
});

export function SavedReviewsSection() {
  const {
    nonWorkingTreeReviews,
    isLoadingCritical,
    onSelectReview,
    prefersReducedMotion,
  } = useSidebarData();
  const deleteReview = useReviewStore((s) => s.deleteReview);

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Handle delete with confirmation
  const handleDeleteConfirm = useCallback(
    async (comparison: Comparison) => {
      await deleteReview(comparison);
      setConfirmDelete(null);
    },
    [deleteReview],
  );

  if (nonWorkingTreeReviews.length === 0 && !isLoadingCritical) {
    return null;
  }

  return (
    <section aria-labelledby="recent-reviews-heading" className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="recent-reviews-heading"
          className="text-xs font-semibold text-stone-400 uppercase tracking-wider flex items-center gap-2"
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-sage-400"
            aria-hidden="true"
          />
          Continue
        </h2>
        {isLoadingCritical && (
          <div
            className="h-3 w-3 animate-spin rounded-full border border-stone-700 border-t-green-500"
            role="status"
            aria-label="Loading reviews..."
          />
        )}
      </div>

      {nonWorkingTreeReviews.length > 0 && (
        <div className="space-y-2" role="list">
          {nonWorkingTreeReviews.map((review, index) => (
            <ReviewCard
              key={review.comparison.key}
              review={review}
              index={index}
              isDeleting={confirmDelete === review.comparison.key}
              prefersReducedMotion={prefersReducedMotion}
              onSelect={() => onSelectReview(review.comparison)}
              onDeleteClick={() => setConfirmDelete(review.comparison.key)}
              onDeleteConfirm={() => handleDeleteConfirm(review.comparison)}
              onDeleteCancel={() => setConfirmDelete(null)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
