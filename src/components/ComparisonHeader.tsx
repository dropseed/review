import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { Comparison, BranchList } from "../types";
import { makeComparison } from "../types";
import { useReviewStore } from "../stores/reviewStore";
import { BranchSelect, WORKING_TREE, STAGED_ONLY } from "./BranchSelect";
import { getApiClient } from "../api";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { SimpleTooltip } from "./ui/tooltip";

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

interface ComparisonHeaderProps {
  comparison: Comparison;
  repoPath: string;
  onSelectReview: (comparison: Comparison) => void;
}

export function ComparisonHeader({
  comparison,
  repoPath,
  onSelectReview,
}: ComparisonHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);

  const compareDisplay = comparison.workingTree
    ? "Working Tree"
    : comparison.stagedOnly
      ? "Staged"
      : comparison.new;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <div className="relative flex items-center h-full">
        {/* Clickable comparison display */}
        <PopoverTrigger asChild>
          <SimpleTooltip content="Switch comparison">
            <button
              className={`flex items-center gap-2 h-full px-1 -mx-1 rounded
                       transition-colors duration-100
                       hover:bg-stone-800/50
                       ${isOpen ? "bg-stone-800/50" : ""}`}
            >
              {/* Base ref */}
              <span
                className="inline-flex items-center font-mono text-sm text-stone-300 px-2 py-1 rounded-md
                         bg-stone-800/50 border border-stone-700/30"
              >
                {comparison.old}
              </span>

              {/* Range indicator */}
              <span className="text-stone-600 font-mono text-sm select-none">
                ..
              </span>

              {/* Compare ref */}
              <span
                className={`inline-flex items-center font-mono text-sm px-2 py-1 rounded-md border
                          ${
                            comparison.workingTree
                              ? "text-violet-400 bg-violet-500/10 border-violet-500/20"
                              : comparison.stagedOnly
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                : "text-stone-300 bg-stone-800/50 border-stone-700/30"
                          }`}
              >
                {compareDisplay}
              </span>

              {/* Chevron */}
              <svg
                className={`h-3 w-3 text-stone-500 transition-transform duration-150 ml-0.5 ${isOpen ? "rotate-180" : ""}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </SimpleTooltip>
        </PopoverTrigger>

        <PopoverContent className="w-[420px] p-0" align="start">
          <ReviewsPopover
            repoPath={repoPath}
            currentComparison={comparison}
            onSelectReview={(c) => {
              onSelectReview(c);
              setIsOpen(false);
            }}
          />
        </PopoverContent>
      </div>
    </Popover>
  );
}

// --- Popover content ---

interface ReviewsPopoverProps {
  repoPath: string;
  currentComparison: Comparison;
  onSelectReview: (comparison: Comparison) => void;
}

function ReviewsPopover({
  repoPath,
  currentComparison,
  onSelectReview,
}: ReviewsPopoverProps) {
  const { savedReviews, savedReviewsLoading, loadSavedReviews, deleteReview } =
    useReviewStore();

  const [branches, setBranches] = useState<BranchList>({
    local: [],
    remote: [],
    stashes: [],
  });
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [compareRef, setCompareRef] = useState("");
  const [currentBranch, setCurrentBranch] = useState("HEAD");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const hasInitialized = useRef(false);

  // Load data on mount
  useEffect(() => {
    hasInitialized.current = false;
    loadSavedReviews();

    setBranchesLoading(true);
    const client = getApiClient();
    Promise.all([
      client.listBranches(repoPath),
      client.getDefaultBranch(repoPath),
      client.getCurrentBranch(repoPath),
    ])
      .then(([branchList, defBranch, curBranch]) => {
        setBranches(branchList);
        setBaseRef(defBranch);
        setCurrentBranch(curBranch);
        setCompareRef(WORKING_TREE);
      })
      .catch((err) => {
        console.error("Failed to load branches:", err);
        setBranches({ local: ["main", "master"], remote: [], stashes: [] });
        setBaseRef("main");
      })
      .finally(() => setBranchesLoading(false));
  }, [repoPath, loadSavedReviews]);

  // Once saved reviews load, pick a compareRef that doesn't duplicate an existing review
  useEffect(() => {
    if (hasInitialized.current || !baseRef || savedReviews.length === 0) return;
    hasInitialized.current = true;

    const existingKeys = savedReviews.map((r) => r.comparison.key);
    const makeKey = (compare: string) => {
      if (compare === WORKING_TREE)
        return `${baseRef}..${currentBranch}+working-tree`;
      if (compare === STAGED_ONLY)
        return `${baseRef}..${currentBranch}+staged-only`;
      return `${baseRef}..${compare}`;
    };

    if (!existingKeys.includes(makeKey(WORKING_TREE))) {
      setCompareRef(WORKING_TREE);
    } else if (!existingKeys.includes(makeKey(STAGED_ONLY))) {
      setCompareRef(STAGED_ONLY);
    } else {
      setCompareRef("");
    }
  }, [savedReviews, baseRef, currentBranch]);

  const existingComparisonKeys = useMemo(
    () => savedReviews.map((r) => r.comparison.key),
    [savedReviews],
  );

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

  const handleDeleteConfirm = useCallback(
    async (comparison: Comparison) => {
      await deleteReview(comparison);
      setConfirmDelete(null);
    },
    [deleteReview],
  );

  const hasReviews = savedReviews.length > 0;

  return (
    <div>
      {/* Saved reviews list */}
      {(hasReviews || savedReviewsLoading) && (
        <div className="border-b border-stone-800/60">
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Reviews
            </span>
            {savedReviewsLoading && (
              <div className="h-2.5 w-2.5 animate-spin rounded-full border border-stone-700 border-t-stone-400" />
            )}
          </div>

          <div className="max-h-[240px] overflow-y-auto scrollbar-thin py-1">
            {savedReviews.map((review) => {
              const isActive = review.comparison.key === currentComparison.key;
              const isDeleting = confirmDelete === review.comparison.key;
              const compareLabel = review.comparison.workingTree
                ? "Working Tree"
                : review.comparison.stagedOnly
                  ? "Staged"
                  : review.comparison.new;
              const progress =
                review.totalHunks > 0
                  ? Math.round((review.reviewedHunks / review.totalHunks) * 100)
                  : 0;

              if (isDeleting) {
                return (
                  <div
                    key={review.comparison.key}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <span className="text-xs text-stone-400 flex-1">
                      Delete this review?
                    </span>
                    <button
                      onClick={() => handleDeleteConfirm(review.comparison)}
                      className="text-[11px] text-red-400 hover:text-red-300 px-2 py-0.5 rounded
                                   bg-red-500/10 hover:bg-red-500/20 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-[11px] text-stone-500 hover:text-stone-300 px-2 py-0.5 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={review.comparison.key}
                  className={`group relative flex items-center gap-2 mx-1 rounded-md transition-colors duration-75
                               ${isActive ? "bg-lime-500/10 border border-lime-500/20" : "hover:bg-stone-800/50 border border-transparent"}`}
                >
                  <button
                    onClick={() => onSelectReview(review.comparison)}
                    disabled={isActive}
                    className="flex-1 text-left px-2.5 py-2 min-w-0"
                  >
                    {/* Refs row */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`font-mono text-xs truncate ${isActive ? "text-stone-200" : "text-stone-400"}`}
                      >
                        {review.comparison.old}
                      </span>
                      <span className="text-stone-600 text-[10px] shrink-0">
                        ..
                      </span>
                      <span
                        className={`font-mono text-xs truncate ${
                          review.comparison.workingTree
                            ? "text-violet-400"
                            : review.comparison.stagedOnly
                              ? "text-emerald-400"
                              : isActive
                                ? "text-stone-200"
                                : "text-stone-300"
                        }`}
                      >
                        {compareLabel}
                      </span>
                      {isActive && (
                        <span className="text-[10px] text-lime-400/80 font-medium shrink-0 ml-auto">
                          Current
                        </span>
                      )}
                    </div>

                    {/* Progress row */}
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 flex items-center gap-1.5">
                        <div className="w-16 h-[3px] rounded-full bg-stone-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-lime-500/80 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-stone-500 tabular-nums">
                          {review.reviewedHunks}/{review.totalHunks}
                        </span>
                      </div>
                      <span className="text-[10px] text-stone-600 tabular-nums">
                        {formatRelativeTime(review.updatedAt)}
                      </span>
                    </div>
                  </button>

                  {/* Delete button */}
                  {!isActive && (
                    <SimpleTooltip content="Delete review">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(review.comparison.key);
                        }}
                        className="opacity-0 group-hover:opacity-100 absolute right-1.5 top-1.5
                                   p-1 rounded text-stone-600 hover:text-red-400 hover:bg-red-500/10
                                   transition-all duration-100"
                      >
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </SimpleTooltip>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* New comparison creator */}
      <div className="px-3 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            New Review
          </span>
        </div>
        <div className="flex items-center gap-2">
          <BranchSelect
            value={baseRef}
            onChange={(newBase) => {
              setBaseRef(newBase);
              if (compareRef === newBase) setCompareRef("");
            }}
            label="Base"
            branches={branches}
            variant="base"
            disabled={branchesLoading}
          />
          <span className="text-stone-600 text-sm font-light select-none">
            ..
          </span>
          <BranchSelect
            value={compareRef}
            onChange={setCompareRef}
            label="Compare"
            branches={branches}
            variant="compare"
            disabled={branchesLoading}
            excludeValue={baseRef}
            includeLocalState
            baseValue={baseRef}
            existingComparisonKeys={existingComparisonKeys}
            placeholder="Compare..."
          />
          <button
            onClick={handleStartReview}
            disabled={!baseRef || !compareRef || branchesLoading}
            className="shrink-0 rounded-md bg-lime-500/90 px-3 py-1.5 text-xs font-semibold text-stone-950
                         hover:bg-lime-400 transition-colors
                         disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
