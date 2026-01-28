import { useState, useEffect, useCallback, useMemo, memo } from "react";
import type { Comparison, BranchList } from "../types";
import type { ReviewSummary } from "../types";
import { makeComparison } from "../types";
import { useReviewStore } from "../stores/reviewStore";
import { BranchSelect, WORKING_TREE, STAGED_ONLY } from "./BranchSelect";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";

// Hook for reduced motion preference (reactive)
function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

interface StartScreenProps {
  repoPath: string;
  onSelectReview: (comparison: Comparison) => void;
  onOpenRepo: () => void;
  onCloseRepo: () => void;
  onOpenSettings?: () => void;
}

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

  const compareDisplay = review.comparison.workingTree
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
                 hover:border-green-500/25 hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl hover:shadow-green-900/10
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

// Main component
export function StartScreen({
  repoPath,
  onSelectReview,
  onOpenRepo,
  onCloseRepo,
  onOpenSettings,
}: StartScreenProps) {
  const { savedReviews, savedReviewsLoading, loadSavedReviews, deleteReview } =
    useReviewStore();

  // Accessibility: reactive reduced motion preference
  const prefersReducedMotion = usePrefersReducedMotion();

  const [branches, setBranches] = useState<BranchList>({
    local: [],
    remote: [],
    stashes: [],
  });
  const [branchesLoading, setBranchesLoading] = useState(false);

  // New comparison form state
  const [baseRef, setBaseRef] = useState("");
  const [compareRef, setCompareRef] = useState("");
  const [currentBranch, setCurrentBranch] = useState("HEAD");

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // App version
  const [appVersion, setAppVersion] = useState<string>("");

  // Load app version on mount
  useEffect(() => {
    getPlatformServices()
      .window.getVersion()
      .then(setAppVersion)
      .catch(console.error);
  }, []);

  // Load saved reviews and branches on mount
  useEffect(() => {
    loadSavedReviews();

    setBranchesLoading(true);
    const client = getApiClient();
    Promise.all([
      client.listBranches(repoPath),
      client.getDefaultBranch(repoPath),
      client.getCurrentBranch(repoPath),
      client.getGitStatus(repoPath),
      client.listSavedReviews(repoPath),
    ])
      .then(([branchList, defBranch, curBranch, gitStatus, reviews]) => {
        setBranches(branchList);
        setBaseRef(defBranch);
        setCurrentBranch(curBranch);

        // Smart default for compare branch (only if not already in review):
        // 1. If there are uncommitted changes, default to Working Tree
        // 2. Else if current branch is different from base, use current branch
        // 3. Else use the most recently edited branch that doesn't have a review
        const hasUncommittedChanges =
          gitStatus.staged.length > 0 ||
          gitStatus.unstaged.length > 0 ||
          gitStatus.untracked.length > 0;

        const reviewKeys = new Set(reviews.map((r) => r.comparison.key));

        let smartDefault: string | null = null;

        if (hasUncommittedChanges) {
          const workingTreeKey = `${defBranch}..${curBranch}+working-tree`;
          if (!reviewKeys.has(workingTreeKey)) {
            smartDefault = WORKING_TREE;
          }
        }

        if (!smartDefault && curBranch !== defBranch) {
          const branchKey = `${defBranch}..${curBranch}`;
          if (!reviewKeys.has(branchKey)) {
            smartDefault = curBranch;
          }
        }

        // Fallback: find the most recently edited branch without a review
        // (branchList.local is sorted by most recent commit date)
        if (!smartDefault) {
          for (const branch of branchList.local) {
            if (branch === defBranch) continue; // Skip the base branch
            const branchKey = `${defBranch}..${branch}`;
            if (!reviewKeys.has(branchKey)) {
              smartDefault = branch;
              break;
            }
          }
        }

        if (smartDefault) {
          setCompareRef(smartDefault);
        }
      })
      .catch((err) => {
        console.error("Failed to load branches:", err);
        setBranches({ local: ["main", "master"], remote: [], stashes: [] });
        setBaseRef("main");
      })
      .finally(() => setBranchesLoading(false));
  }, [repoPath, loadSavedReviews]);

  // Extract existing comparison keys to filter duplicates
  const existingComparisonKeys = useMemo(
    () => savedReviews.map((r) => r.comparison.key),
    [savedReviews],
  );

  // Handle starting a new review
  const handleStartReview = useCallback(() => {
    if (!baseRef || !compareRef) return;
    const isWorkingTree = compareRef === WORKING_TREE;
    const isStagedOnly = compareRef === STAGED_ONLY;
    const newRef = isWorkingTree || isStagedOnly ? currentBranch : compareRef;
    const comparison = makeComparison(
      baseRef,
      newRef,
      isWorkingTree,
      isStagedOnly,
    );
    onSelectReview(comparison);
  }, [baseRef, compareRef, currentBranch, onSelectReview]);

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
    <div className="h-screen overflow-auto bg-stone-950 flex flex-col relative texture-noise">
      {/* Subtle gradient overlay for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(74, 140, 90, 0.07) 0%, transparent 60%)",
        }}
        aria-hidden="true"
      />

      {/* Main content - vertically centered */}
      <main className="relative flex-1 flex flex-col justify-center mx-auto w-full max-w-xl px-6 py-10">
        {/* App branding */}
        <header className="mb-12">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <svg
              className="w-20 h-20 shrink-0"
              viewBox="0 0 256 256"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                {/* Gradients for each half */}
                <linearGradient id="logo-red" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#a63d2f" />
                  <stop offset="100%" stopColor="#c75d4a" />
                </linearGradient>
                <linearGradient id="logo-green" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#4a7c59" />
                  <stop offset="100%" stopColor="#6b9b7a" />
                </linearGradient>
                {/* Clip to overall rounded square shape */}
                <clipPath id="logo-body">
                  <rect x="28" y="28" width="200" height="200" rx="48" />
                </clipPath>
                {/* Mask for the checkmark cutout */}
                <mask
                  id="logo-mark"
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width="256"
                  height="256"
                >
                  <rect width="256" height="256" fill="white" />
                  <path
                    d="M 68 138 L 108 178 L 188 82"
                    stroke="black"
                    strokeWidth="24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </mask>
              </defs>
              {/* Left half - terracotta gradient (before/removed) */}
              <rect
                x="28"
                y="28"
                width="88"
                height="200"
                fill="url(#logo-red)"
                clipPath="url(#logo-body)"
                mask="url(#logo-mark)"
              />
              {/* Right half - sage green gradient (after/added) */}
              <rect
                x="140"
                y="28"
                width="88"
                height="200"
                fill="url(#logo-green)"
                clipPath="url(#logo-body)"
                mask="url(#logo-mark)"
              />
            </svg>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-stone-100">
                Compare
              </h1>
              <p className="text-base text-stone-400 mt-1.5">
                Trust the <span className="italic text-stone-300">trivial</span>
                . Review the{" "}
                <span className="font-medium text-stone-200">rest</span>.
              </p>
            </div>
          </div>

          {/* Repo path indicator */}
          <div className="mt-6 inline-flex items-center gap-1">
            <button
              onClick={onOpenRepo}
              className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-900/50 border border-stone-800/50 transition-all duration-150 hover:bg-stone-800/50 hover:border-stone-700/50 focus:outline-none focus:ring-2 focus:ring-sage-500/50"
            >
              <svg
                className="w-4 h-4 text-stone-500 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                />
              </svg>
              <span className="font-mono text-sm text-stone-400 group-hover:text-stone-300 transition-colors">
                {repoPath.replace(/^\/Users\/[^/]+/, "~")}
              </span>
            </button>
            <button
              onClick={onCloseRepo}
              className="p-1.5 rounded-lg text-stone-600 hover:text-stone-300 hover:bg-stone-800/50 transition-all focus:outline-none focus:ring-2 focus:ring-sage-500/50"
              title="Close repository"
              aria-label="Close repository"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </header>

        {/* Recent Reviews */}
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

        {/* New Comparison - inline form */}
        <section
          aria-labelledby="new-comparison-heading"
          className="mt-10"
          onKeyDown={handleFormKeyDown}
        >
          <h2
            id="new-comparison-heading"
            className="mb-4 text-sm font-semibold text-stone-300 flex items-center gap-2"
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-terracotta-400"
              aria-hidden="true"
            />
            New Comparison
          </h2>

          {/* Inline form with clear visual boundary */}
          <div className="flex flex-nowrap items-center gap-3 rounded-xl border border-stone-800/60 bg-gradient-to-br from-stone-900/60 to-stone-950/80 px-5 py-4 shadow-inner shadow-black/20">
            <BranchSelect
              value={baseRef}
              onChange={(newBase) => {
                setBaseRef(newBase);
                // Reset compare if it matches the new base or would be invalid
                if (compareRef === newBase) {
                  setCompareRef("");
                }
              }}
              label="Base branch"
              branches={branches}
              variant="base"
              disabled={branchesLoading}
            />

            <span
              className="text-stone-600 text-lg font-light select-none tracking-widest shrink-0"
              aria-hidden="true"
            >
              ..
            </span>

            <BranchSelect
              value={compareRef}
              onChange={setCompareRef}
              label="Compare branch"
              branches={branches}
              variant="compare"
              disabled={branchesLoading}
              excludeValue={baseRef}
              includeLocalState
              baseValue={baseRef}
              existingComparisonKeys={existingComparisonKeys}
              placeholder="Compare..."
            />

            <div className="flex-1" />

            <button
              onClick={handleStartReview}
              disabled={!baseRef || !compareRef || branchesLoading}
              className="group/btn btn-interactive relative shrink-0 rounded-lg bg-gradient-to-r from-sage-500 to-sage-400 px-5 py-2
                         text-sm font-semibold text-stone-950
                         transition-all duration-200
                         hover:from-sage-400 hover:to-sage-400 hover:shadow-lg hover:shadow-sage-500/30 hover:-translate-y-0.5
                         focus:outline-none focus:ring-2 focus:ring-sage-400 focus:ring-offset-2 focus:ring-offset-stone-900
                         disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none disabled:from-sage-600 disabled:to-sage-600
                         active:translate-y-0 active:shadow-none"
            >
              <span className="flex items-center gap-1.5">
                Start
                <svg
                  className="w-4 h-4 transition-transform duration-200 group-hover/btn:translate-x-0.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            </button>
          </div>
        </section>
      </main>

      {/* Footer - subtle, anchored to bottom */}
      <footer className="relative shrink-0 px-6 py-5 flex items-center justify-between text-xs text-stone-600 border-t border-stone-900/50">
        {/* Left: PullApprove attribution + version + docs */}
        <div className="flex items-center gap-3">
          <span className="text-stone-600">A tool from</span>
          <a
            href="https://www.pullapprove.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500/50 rounded px-1 -mx-1 transition-colors"
          >
            <svg
              className="h-3 w-auto opacity-70"
              viewBox="0 0 350 239"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M283.772 102.429C264.913 121.174 241.341 144.605 213.278 172.5L167.255 218.247C152.213 232.082 133.579 239 111.578 239C89.5767 239 70.9429 232.082 55.9012 218.247L37.2675 199.725L0 236.768V126.083H111.353L74.3105 163.127L92.9442 181.649C97.8833 186.335 104.169 188.567 111.578 188.567C118.987 188.567 125.048 186.335 130.212 181.649L246.729 65.831C244.484 56.9048 244.259 48.2017 246.504 39.2754C248.525 30.3492 253.239 22.5387 260.199 15.6209C270.975 5.13259 283.323 0 297.242 0C311.161 0 323.509 5.13259 334.285 15.6209C344.612 26.3324 350 38.606 350 52.4416C350 66.2773 344.836 78.5509 334.285 89.2624C327.325 96.1802 319.468 100.643 310.488 102.875C301.507 104.883 292.752 104.883 283.772 102.429ZM319.468 30.1261C313.182 24.1008 305.548 21.1998 297.242 21.1998C288.711 21.1998 281.302 24.324 275.241 30.3492C268.954 36.5976 266.036 43.7386 266.036 52.2185C266.036 60.6984 269.179 68.0626 275.241 74.0878C281.527 80.3361 288.711 83.2372 297.242 83.2372C305.773 83.2372 313.182 80.113 319.243 74.0878C325.529 67.8394 328.448 60.6984 328.448 52.2185C328.448 43.9617 325.305 36.5976 319.468 30.1261Z" />
            </svg>
            <span>PullApprove</span>
          </a>
          <span className="text-stone-800">·</span>
          {appVersion && (
            <span className="font-mono text-stone-600 tabular-nums">
              v{appVersion}
            </span>
          )}
          <span className="text-stone-800">·</span>
          <a
            href="https://github.com/dropseed/compare#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="text-stone-500 hover:text-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500/50 rounded transition-colors"
          >
            Docs
          </a>
        </div>

        {/* Right: settings + keyboard shortcut */}
        <div className="flex items-center gap-4 text-stone-500">
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-stone-500 hover:text-stone-300 transition-colors focus:outline-none focus:ring-2 focus:ring-sage-500/50 rounded px-1 -mx-1"
              title="Settings"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Settings</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <kbd className="inline-flex items-center gap-0.5 rounded-md border border-stone-800/80 bg-stone-900/80 px-1.5 py-1 font-mono text-[10px] text-stone-400 shadow-sm">
              <span>⌘</span>
              <span>O</span>
            </kbd>
            <span className="text-stone-600">open new repo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
