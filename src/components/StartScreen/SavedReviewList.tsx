import { useState, useCallback, memo } from "react";
import type { Comparison } from "../../types";
import type { ReviewSummary } from "../../types";

// Intl.RelativeTimeFormat for proper i18n
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Format relative time using Intl.RelativeTimeFormat for better i18n
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

// Format comparison for display
function formatComparison(comparison: Comparison): string {
  let compareRef = comparison.new;
  if (comparison.stagedOnly) {
    compareRef = "Staged";
  } else if (comparison.workingTree) {
    compareRef = "Working Tree";
  }
  return `${comparison.old}..${compareRef}`;
}

// Empty state component with illustration
const EmptyState = memo(function EmptyState() {
  return (
    <div className="rounded-xl border border-stone-800/40 bg-gradient-to-br from-stone-900/40 to-stone-950/60 px-6 py-8">
      <div className="flex items-start gap-4">
        {/* Illustration: split diff icon */}
        <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-terracotta-500/20 to-sage-500/20 flex items-center justify-center">
          <svg
            className="w-7 h-7"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            {/* Left half (old/terracotta) */}
            <rect
              x="3"
              y="4"
              width="7"
              height="16"
              rx="1.5"
              fill="#a63d2f"
              fillOpacity="0.7"
            />
            <line
              x1="5"
              y1="8"
              x2="8"
              y2="8"
              stroke="#c75d4a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="5"
              y1="12"
              x2="8"
              y2="12"
              stroke="#c75d4a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="5"
              y1="16"
              x2="7"
              y2="16"
              stroke="#c75d4a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            {/* Right half (new/sage) */}
            <rect
              x="14"
              y="4"
              width="7"
              height="16"
              rx="1.5"
              fill="#4a7c59"
              fillOpacity="0.7"
            />
            <line
              x1="16"
              y1="8"
              x2="19"
              y2="8"
              stroke="#6b9b7a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="16"
              y1="12"
              x2="19"
              y2="12"
              stroke="#6b9b7a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="16"
              y1="16"
              x2="18"
              y2="16"
              stroke="#6b9b7a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            {/* Arrow between */}
            <path
              d="M11 12h2"
              stroke="#78716c"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-300 font-medium">No reviews yet</p>
          <p className="mt-1 text-xs text-stone-500 leading-relaxed">
            A <span className="text-stone-400">comparison</span> shows changes
            between two git refs. Start by selecting a base branch and what you
            want to compare it against.
          </p>

          {/* Visual pointer to form */}
          <div className="mt-4 flex items-center gap-2 text-xs text-stone-600">
            <svg
              className="w-4 h-4 animate-bounce"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                clipRule="evenodd"
              />
            </svg>
            <span>Create your first comparison below</span>
          </div>
        </div>
      </div>
    </div>
  );
});

// Review card component
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
  const compareDisplay = isPr
    ? `PR #${review.comparison.githubPr!.number}: ${review.comparison.githubPr!.title}`
    : review.comparison.workingTree
      ? "Working Tree"
      : review.comparison.stagedOnly
        ? "Staged"
        : review.comparison.new;

  // Ensure progress bar is visible even at tiny percentages
  const progressWidth = progress > 0 ? Math.max(progress, 5) : 0;

  return (
    <article
      className={`group relative rounded-xl border border-stone-800/80 bg-gradient-to-br from-stone-900/80 to-stone-900/40
                 backdrop-blur-sm shadow-lg shadow-black/20
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
                   focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:ring-inset"
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
                         focus:outline-none focus:ring-2 focus:ring-stone-500/50"
            >
              Cancel
            </button>
            <button
              onClick={onDeleteConfirm}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-400 bg-red-500/10
                         hover:bg-red-500/20
                         focus:outline-none focus:ring-2 focus:ring-red-500/50"
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
                       focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-stone-500/50"
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

      {savedReviews.length === 0 && !savedReviewsLoading ? (
        <EmptyState />
      ) : (
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
