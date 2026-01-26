import { useState, useEffect, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Comparison, BranchList } from "../types";
import type { ReviewSummary } from "../types";
import { makeComparison } from "../types";
import { useReviewStore } from "../stores/reviewStore";

interface StartScreenProps {
  repoPath: string;
  onSelectReview: (comparison: Comparison) => void;
}

// Special values for local state options
const WORKING_TREE = "__WORKING_TREE__";
const STAGED_ONLY = "__STAGED_ONLY__";

// Format relative time with proper grammar
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Format comparison for display
function formatComparison(comparison: Comparison): string {
  let compareRef = comparison.new;
  if (comparison.stagedOnly) {
    compareRef = "Staged";
  } else if (comparison.workingTree && comparison.new === "HEAD") {
    compareRef = "Working Tree";
  }
  return `${comparison.old}..${compareRef}`;
}

// Empty state component
const EmptyState = memo(function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-stone-800 bg-stone-900/30 px-6 py-10 text-center">
      <svg
        className="mx-auto mb-3 h-10 w-10 text-stone-700"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>
      <p className="text-sm text-stone-500">No saved reviews yet</p>
      <p className="mt-1 text-xs text-stone-600">
        Start a new comparison below
      </p>
    </div>
  );
});

// Review card component
interface ReviewCardProps {
  review: ReviewSummary;
  index: number;
  isDeleting: boolean;
  onSelect: () => void;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}

const ReviewCard = memo(function ReviewCard({
  review,
  index,
  isDeleting,
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

  return (
    <article
      className="animate-fade-in group relative rounded-xl border border-stone-800 bg-stone-900/50
                 transition-colors duration-150 hover:border-stone-700 hover:bg-stone-900
                 focus-within:ring-1 focus-within:ring-lime-500/30"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <button
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        className="w-full px-4 py-3 text-left focus:outline-none focus-visible:ring-2
                   focus-visible:ring-lime-500/50 focus-visible:ring-offset-2
                   focus-visible:ring-offset-stone-950 rounded-xl"
        aria-label={`Open review ${formatComparison(review.comparison)}, ${progress}% complete`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm text-stone-200">
                {formatComparison(review.comparison)}
              </span>
              {review.completedAt && (
                <span className="shrink-0 rounded-full bg-lime-500/20 px-1.5 py-0.5 text-xxs font-medium text-lime-400">
                  Complete
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
              <time dateTime={review.updatedAt}>
                Updated {formatRelativeTime(review.updatedAt)}
              </time>
              {review.totalHunks > 0 && (
                <>
                  <span className="text-stone-700" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    {review.reviewedHunks}/{review.totalHunks} reviewed
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Progress indicator */}
          {review.totalHunks > 0 && (
            <div className="flex shrink-0 items-center gap-2">
              <div
                className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-800"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Review progress: ${progress}%`}
              >
                <div
                  className={`h-full transition-[width] duration-300 ${
                    review.completedAt ? "bg-lime-500" : "bg-amber-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-xxs tabular-nums text-stone-500">
                {progress}%
              </span>
            </div>
          )}
        </div>
      </button>

      {/* Delete button */}
      <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {isDeleting ? (
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Confirm deletion"
          >
            <button
              onClick={onDeleteConfirm}
              className="rounded px-2 py-1 text-xs text-red-400
                         hover:bg-red-500/20 focus:outline-none focus-visible:ring-2
                         focus-visible:ring-red-500/50"
            >
              Delete
            </button>
            <button
              onClick={onDeleteCancel}
              className="rounded px-2 py-1 text-xs text-stone-400
                         hover:bg-stone-800 focus:outline-none focus-visible:ring-2
                         focus-visible:ring-stone-500/50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick();
            }}
            className="rounded p-1 text-stone-600 hover:bg-stone-800 hover:text-stone-400
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/50"
            aria-label={`Delete review ${formatComparison(review.comparison)}`}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
});

// Main component
export function StartScreen({ repoPath, onSelectReview }: StartScreenProps) {
  const { savedReviews, savedReviewsLoading, loadSavedReviews, deleteReview } =
    useReviewStore();

  const [branches, setBranches] = useState<BranchList>({
    local: [],
    remote: [],
    stashes: [],
  });
  const [branchesLoading, setBranchesLoading] = useState(false);

  // New comparison form state
  const [baseRef, setBaseRef] = useState("");
  const [compareRef, setCompareRef] = useState(WORKING_TREE);

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Load saved reviews and branches on mount
  useEffect(() => {
    loadSavedReviews();

    setBranchesLoading(true);
    Promise.all([
      invoke<BranchList>("list_branches", { repoPath }),
      invoke<string>("get_default_branch", { repoPath }),
    ])
      .then(([branchList, defBranch]) => {
        setBranches(branchList);
        setBaseRef(defBranch);
      })
      .catch((err) => {
        console.error("Failed to load branches:", err);
        setBranches({ local: ["main", "master"], remote: [], stashes: [] });
        setBaseRef("main");
      })
      .finally(() => setBranchesLoading(false));
  }, [repoPath, loadSavedReviews]);

  // All branches combined for validation checks
  const allBranches = [...branches.local, ...branches.remote];

  // Handle starting a new review
  const handleStartReview = useCallback(() => {
    if (!baseRef) return;
    const isWorkingTree = compareRef === WORKING_TREE;
    const isStagedOnly = compareRef === STAGED_ONLY;
    const newRef = isWorkingTree || isStagedOnly ? "HEAD" : compareRef;
    const comparison = makeComparison(
      baseRef,
      newRef,
      isWorkingTree,
      isStagedOnly,
    );
    onSelectReview(comparison);
  }, [baseRef, compareRef, onSelectReview]);

  // Handle keyboard submit for form
  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && baseRef) {
        handleStartReview();
      }
    },
    [baseRef, handleStartReview],
  );

  // Handle delete with confirmation
  const handleDeleteConfirm = useCallback(
    async (comparison: Comparison) => {
      await deleteReview(comparison);
      setConfirmDelete(null);
    },
    [deleteReview],
  );

  return (
    <div className="h-screen overflow-auto bg-stone-950">
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Saved Reviews Section */}
        <section aria-labelledby="recent-reviews-heading" className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2
              id="recent-reviews-heading"
              className="text-sm font-medium uppercase tracking-wider text-stone-500"
            >
              Recent Reviews
            </h2>
            {savedReviewsLoading && (
              <div
                className="h-4 w-4 animate-spin rounded-full border-2 border-stone-700 border-t-lime-500"
                role="status"
                aria-label="Loading reviews…"
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
                  onSelect={() => onSelectReview(review.comparison)}
                  onDeleteClick={() => setConfirmDelete(review.comparison.key)}
                  onDeleteConfirm={() => handleDeleteConfirm(review.comparison)}
                  onDeleteCancel={() => setConfirmDelete(null)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="relative mb-10" aria-hidden="true">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-stone-800" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-stone-950 px-3 text-xs uppercase tracking-wider text-stone-600">
              or
            </span>
          </div>
        </div>

        {/* New Comparison Section */}
        <section aria-labelledby="new-comparison-heading">
          <h2
            id="new-comparison-heading"
            className="mb-4 text-sm font-medium uppercase tracking-wider text-stone-500"
          >
            New Comparison
          </h2>

          <div
            className="rounded-xl border border-stone-800 bg-stone-900/50 p-5"
            onKeyDown={handleFormKeyDown}
          >
            <div className="flex items-end gap-3">
              {/* Base branch */}
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="base-branch"
                  className="mb-1.5 block text-xs text-stone-500"
                >
                  Base
                </label>
                <select
                  id="base-branch"
                  name="base"
                  value={baseRef}
                  onChange={(e) => {
                    const newBase = e.target.value;
                    setBaseRef(newBase);
                    // Reset compare ref if it matches the new base
                    if (compareRef === newBase) {
                      setCompareRef(WORKING_TREE);
                    }
                  }}
                  disabled={branchesLoading}
                  className="w-full rounded-lg border border-stone-700/50 bg-stone-800/80 px-3 py-2
                               text-sm text-stone-200 transition-colors duration-150
                               hover:border-stone-600 focus:border-lime-500/50 focus:outline-none
                               focus:ring-1 focus:ring-lime-500/30
                               disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {branches.local.length > 0 && (
                    <optgroup label="Local">
                      {branches.local.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {branches.remote.length > 0 && (
                    <optgroup label="Remote">
                      {branches.remote.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {!allBranches.includes(baseRef) && baseRef && (
                    <option value={baseRef}>{baseRef}</option>
                  )}
                </select>
              </div>

              {/* Separator */}
              <div className="pb-2.5 text-stone-600" aria-hidden="true">
                ..
              </div>

              {/* Compare branch */}
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="compare-branch"
                  className="mb-1.5 block text-xs text-stone-500"
                >
                  Compare
                </label>
                <select
                  id="compare-branch"
                  name="compare"
                  value={compareRef}
                  onChange={(e) => setCompareRef(e.target.value)}
                  disabled={branchesLoading}
                  className="w-full rounded-lg border border-stone-700/50 bg-stone-800/80 px-3 py-2
                               text-sm text-stone-200 transition-colors duration-150
                               hover:border-stone-600 focus:border-lime-500/50 focus:outline-none
                               focus:ring-1 focus:ring-lime-500/30
                               disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <optgroup label="Local State">
                    <option value={WORKING_TREE}>Working Tree</option>
                    <option value={STAGED_ONLY}>Staged Only</option>
                    {branches.stashes.map((stash) => (
                      <option key={stash.ref} value={stash.ref}>
                        {stash.ref}: {stash.message.slice(0, 30)}
                        {stash.message.length > 30 ? "…" : ""}
                      </option>
                    ))}
                  </optgroup>
                  {branches.local.filter((b) => b !== baseRef).length > 0 && (
                    <optgroup label="Local Branches">
                      {branches.local
                        .filter((branch) => branch !== baseRef)
                        .map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {branches.remote.filter((b) => b !== baseRef).length > 0 && (
                    <optgroup label="Remote Branches">
                      {branches.remote
                        .filter((branch) => branch !== baseRef)
                        .map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Start button */}
              <button
                onClick={handleStartReview}
                disabled={!baseRef || branchesLoading}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-lime-600 px-4 py-2
                             text-sm font-medium text-white transition-colors duration-150
                             hover:bg-lime-500 focus:outline-none focus-visible:ring-2
                             focus-visible:ring-lime-500 focus-visible:ring-offset-2
                             focus-visible:ring-offset-stone-900
                             disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>Start Review</span>
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </button>
            </div>

            {/* Local state indicator */}
            {(compareRef === WORKING_TREE || compareRef === STAGED_ONLY) && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-500">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                  aria-hidden="true"
                />
                {compareRef === WORKING_TREE
                  ? "Includes all uncommitted changes (staged + unstaged)"
                  : "Shows only staged changes (git add)"}
              </p>
            )}
          </div>
        </section>

        {/* Keyboard shortcuts hint */}
        <footer className="mt-8 text-center text-xs text-stone-600">
          <kbd className="rounded bg-stone-800 px-1.5 py-0.5 text-xxs text-stone-500">
            ⌘O
          </kbd>
          <span className="ml-1.5">to open a different repository</span>
        </footer>
      </div>
    </div>
  );
}
