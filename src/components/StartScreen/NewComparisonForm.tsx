import { useState, useEffect, useCallback } from "react";
import type { Comparison, BranchList, PullRequest } from "../../types";
import { makeComparison, makePrComparison } from "../../types";
import { BranchSelect, WORKING_TREE, PR_PREFIX } from "./BranchSelect";
import { getApiClient } from "../../api";

interface NewComparisonFormProps {
  repoPath: string;
  onSelectReview: (comparison: Comparison) => void;
  existingComparisonKeys: string[];
}

export function NewComparisonForm({
  repoPath,
  onSelectReview,
  existingComparisonKeys,
}: NewComparisonFormProps) {
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
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);

  // Load branches on mount
  useEffect(() => {
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

    // Fetch PRs separately (non-blocking, optional)
    client
      .checkGitHubAvailable(repoPath)
      .then((avail) => (avail ? client.listPullRequests(repoPath) : []))
      .then((prs) => setPullRequests(prs))
      .catch(() => setPullRequests([]));
  }, [repoPath]);

  // Handle starting a new review
  const handleStartReview = useCallback(() => {
    if (!baseRef || !compareRef) return;

    // Handle PR selection
    if (compareRef.startsWith(PR_PREFIX)) {
      const prNumber = parseInt(compareRef.slice(PR_PREFIX.length, -2), 10);
      const pr = pullRequests.find((p) => p.number === prNumber);
      if (pr) {
        onSelectReview(makePrComparison(pr));
      }
      return;
    }

    const isWorkingTree = compareRef === WORKING_TREE;
    const newRef = isWorkingTree ? currentBranch : compareRef;
    const comparison = makeComparison(baseRef, newRef, isWorkingTree);
    onSelectReview(comparison);
  }, [baseRef, compareRef, currentBranch, onSelectReview, pullRequests]);

  // Handle keyboard submit for form
  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && baseRef) {
        handleStartReview();
      }
    },
    [baseRef, handleStartReview],
  );

  return (
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
        New Review
      </h2>
      <p className="mb-4 text-xs text-stone-500 leading-relaxed">
        Select a base branch and what you want to compare it against, or choose
        a pull request.
      </p>

      {/* Inline form with clear visual boundary */}
      <div className="flex flex-nowrap items-center gap-3 rounded-xl border border-stone-800/60 bg-gradient-to-br from-stone-900/60 to-stone-950/80 px-5 py-4 shadow-inner shadow-black/20">
        <BranchSelect
          value={baseRef}
          onChange={(newBase) => {
            setBaseRef(newBase);
            // Reset compare if it matches the new base or is a PR targeting a different base
            if (compareRef === newBase) {
              setCompareRef("");
            } else if (compareRef.startsWith(PR_PREFIX)) {
              const prNumber = parseInt(
                compareRef.slice(PR_PREFIX.length, -2),
                10,
              );
              const pr = pullRequests.find((p) => p.number === prNumber);
              if (pr && pr.baseRefName !== newBase) {
                setCompareRef("");
              }
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
          pullRequests={pullRequests}
        />

        <div className="flex-1" />

        <button
          onClick={handleStartReview}
          disabled={!baseRef || !compareRef || branchesLoading}
          className="group/btn btn-interactive relative shrink-0 rounded-lg bg-gradient-to-r from-sage-500 to-sage-400 px-5 py-2
                     text-sm font-semibold text-stone-950
                     transition-all duration-200
                     hover:from-sage-400 hover:to-sage-400 hover:shadow-lg hover:shadow-sage-500/30 hover:-translate-y-0.5
                     focus:outline-hidden focus:ring-2 focus:ring-sage-400 focus:ring-offset-2 focus:ring-offset-stone-900
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
  );
}
