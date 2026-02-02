import { useState, useCallback, memo } from "react";
import type { Comparison, ReviewSummary } from "../../types";

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

/** Returns a display label for the compare side of a review card */
function getCompareDisplay(comparison: Comparison): string {
  if (comparison.githubPr) {
    return `PR #${comparison.githubPr.number}: ${comparison.githubPr.title}`;
  }
  if (comparison.workingTree) return "Working Tree";
  if (comparison.stagedOnly) return "Staged";
  return comparison.new;
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
  const compareDisplay = getCompareDisplay(review.comparison);

  // Ensure progress bar is visible even at tiny percentages
  const progressWidth = progress > 0 ? Math.max(progress, 5) : 0;

  return (
    <article
      className={`group relative rounded-xl border border-stone-800/80 bg-gradient-to-br from-stone-900/80 to-stone-900/40
                 backdrop-blur-xs shadow-lg shadow-black/20
                 transition-all duration-200
                 ${isPr ? "hover:border-violet-500/25 hover:shadow-violet-900/10" : "hover:border-green-500/25 hover:shadow-green-900/10"}
                 hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl
                 hover:-translate-y-0.5
                 ${prefersReducedMotion ? "" : "animate-fade-in"}`}
      style={
        prefersReducedMotion ? undefined : { animationDelay: `${index * 50}ms` }
      }
    >
      <button
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        className="w-full px-5 py-4 text-left rounded-xl
                   focus:outline-hidden focus:inset-ring-2 focus:inset-ring-green-500/50"
        aria-label={`Open review ${formatComparison(review.comparison)}, ${progress}% complete`}
      >
        {/* Main row: Comparison + Progress */}
        <div className="flex items-center gap-4">
          {/* Comparison display */}
          {isPr ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 shrink-0 font-mono text-xs text-violet-400 px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                </svg>
                #{review.comparison.githubPr!.number}
              </span>
              <span className="text-sm text-stone-200 truncate font-medium">
                {review.comparison.githubPr!.title}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-sm text-stone-200 truncate font-medium">
                {review.comparison.old}
              </span>
              <span className="text-stone-600 text-xs">..</span>
              <span
                className={`font-mono text-sm truncate font-medium ${
                  review.comparison.workingTree
                    ? "text-green-400"
                    : review.comparison.stagedOnly
                      ? "text-green-500"
                      : "text-stone-200"
                }`}
              >
                {compareDisplay}
              </span>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Progress: human-readable display */}
          {review.totalHunks > 0 && (
            <div className="flex items-center gap-3">
              {/* Progress bar - thicker with glow */}
              <div
                className="h-1 w-24 overflow-hidden rounded-full bg-stone-800/80"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300 bg-gradient-to-r from-sage-500 to-sage-400"
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
              {/* Human-readable count */}
              <span className="text-xs text-stone-400 whitespace-nowrap">
                {review.reviewedHunks === 0
                  ? `${review.totalHunks} to review`
                  : `${review.reviewedHunks} of ${review.totalHunks}`}
              </span>
            </div>
          )}
        </div>

        {/* Secondary row: Metadata */}
        <div className="mt-2.5 flex items-center gap-2">
          <time dateTime={review.updatedAt} className="text-xs text-stone-500">
            {formatRelativeTime(review.updatedAt)}
          </time>
        </div>
      </button>

      {/* Actions - bottom right */}
      <div className="absolute right-3 bottom-3">
        {isDeleting ? (
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Confirm deletion"
          >
            <button
              onClick={onDeleteCancel}
              className="rounded-md px-2 py-1 text-xs text-stone-400
                         hover:bg-stone-800
                         focus:outline-hidden focus:ring-2 focus:ring-stone-500/50"
            >
              Cancel
            </button>
            <button
              onClick={onDeleteConfirm}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-400 bg-red-500/10
                         hover:bg-red-500/20
                         focus:outline-hidden focus:ring-2 focus:ring-red-500/50"
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
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-stone-500
                       opacity-0 transition-all duration-150
                       hover:text-stone-300 hover:bg-stone-800
                       group-hover:opacity-100 group-focus-within:opacity-100
                       focus:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-stone-500/50"
            aria-label={`More options for ${formatComparison(review.comparison)}`}
          >
            {/* Three dot icon */}
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
});

interface SavedReviewListProps {
  savedReviews: ReviewSummary[];
  savedReviewsLoading: boolean;
  onSelectReview: (comparison: Comparison) => void;
  onDeleteReview: (comparison: Comparison) => Promise<void>;
  prefersReducedMotion: boolean;
}

export function SavedReviewList({
  savedReviews,
  savedReviewsLoading,
  onSelectReview,
  onDeleteReview,
  prefersReducedMotion,
}: SavedReviewListProps) {
  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Handle delete with confirmation
  const handleDeleteConfirm = useCallback(
    async (comparison: Comparison) => {
      await onDeleteReview(comparison);
      setConfirmDelete(null);
    },
    [onDeleteReview],
  );

  if (savedReviews.length === 0 && !savedReviewsLoading) {
    return null;
  }

  return (
    <section aria-labelledby="recent-reviews-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2
          id="recent-reviews-heading"
          className="text-sm font-semibold text-stone-300 flex items-center gap-2"
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-sage-400"
            aria-hidden="true"
          />
          Continue
        </h2>
        {savedReviewsLoading && (
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-stone-700 border-t-green-500"
            role="status"
            aria-label="Loading reviews..."
          />
        )}
      </div>

      {savedReviews.length > 0 && (
        <div className="space-y-2" role="list">
          {savedReviews.map((review, index) => (
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
