import { useState, useEffect, useCallback } from "react";
import type {
  Comparison,
  GitHubPrRef,
  BranchList,
  PullRequest,
} from "../../types";
import { makeComparison, makeComparisonFromPr } from "../../types";
import { BranchSelect, PR_PREFIX } from "./BranchSelect";
import { getApiClient } from "../../api";

interface NewComparisonFormProps {
  repoPath: string;
  onSelectReview: (comparison: Comparison, githubPr?: GitHubPrRef) => void;
  existingComparisonKeys: string[];
  branches?: BranchList | null;
  defaultBranch?: string | null;
}

/**
 * Pick the best default compare branch: prefer the current branch if it
 * doesn't already have a review, otherwise pick the first local branch
 * (sorted by most recent commit) without an existing review.
 */
function pickSmartDefault(
  defaultBranch: string,
  localBranches: string[],
  currentBranch: string | null,
  reviewKeys: Set<string>,
): string | null {
  if (currentBranch) {
    const key = `${defaultBranch}..${currentBranch}`;
    if (!reviewKeys.has(key)) return currentBranch;
  }

  for (const branch of localBranches) {
    if (branch === defaultBranch) continue;
    const key = `${defaultBranch}..${branch}`;
    if (!reviewKeys.has(key)) return branch;
  }

  return null;
}

export function NewComparisonForm({
  repoPath,
  onSelectReview,
  existingComparisonKeys,
  branches: branchesProp,
  defaultBranch: defaultBranchProp,
}: NewComparisonFormProps) {
  const [branchesLocal, setBranchesLocal] = useState<BranchList>({
    local: [],
    remote: [],
    stashes: [],
  });
  const [branchesLoading, setBranchesLoading] = useState(false);

  const [baseRef, setBaseRef] = useState("");
  const [compareRef, setCompareRef] = useState("");
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [smartDefaultSet, setSmartDefaultSet] = useState(false);

  const branches = branchesProp ?? branchesLocal;

  // Reset state when repoPath changes (component stays mounted in the modal)
  useEffect(() => {
    setSmartDefaultSet(false);
    setBaseRef("");
    setCompareRef("");
    setPullRequests([]);
    setBranchesLocal({ local: [], remote: [], stashes: [] });
  }, [repoPath]);

  useEffect(() => {
    if (defaultBranchProp && !baseRef) {
      setBaseRef(defaultBranchProp);
    }
  }, [defaultBranchProp, baseRef]);

  useEffect(() => {
    const client = getApiClient();

    // Fetch PRs (non-blocking, shared by both paths)
    client
      .checkGitHubAvailable(repoPath)
      .then((avail) => (avail ? client.listPullRequests(repoPath) : []))
      .then((prs) => setPullRequests(prs))
      .catch(() => setPullRequests([]));

    // When branches and defaultBranch are provided as props, only fetch
    // the current branch and saved reviews for smart-default selection.
    if (branchesProp !== undefined && defaultBranchProp !== undefined) {
      Promise.all([
        client.getCurrentBranch(repoPath),
        client.listSavedReviews(repoPath),
      ])
        .then(([curBranch, reviews]) => {
          if (!smartDefaultSet && defaultBranchProp && branchesProp) {
            const reviewKeys = new Set(reviews.map((r) => r.comparison.key));
            const smartDefault = pickSmartDefault(
              defaultBranchProp,
              branchesProp.local,
              curBranch,
              reviewKeys,
            );
            if (smartDefault) setCompareRef(smartDefault);
            setSmartDefaultSet(true);
          }
        })
        .catch((err) => {
          console.error("Failed to load branch context:", err);
        });

      return;
    }

    // Fallback: fetch everything (standalone usage without props)
    setBranchesLoading(true);
    Promise.all([
      client.listBranches(repoPath),
      client.getDefaultBranch(repoPath),
      client.getCurrentBranch(repoPath),
      client.listSavedReviews(repoPath),
    ])
      .then(([branchList, defBranch, curBranch, reviews]) => {
        setBranchesLocal(branchList);
        setBaseRef(defBranch);

        const reviewKeys = new Set(reviews.map((r) => r.comparison.key));
        const smartDefault = pickSmartDefault(
          defBranch,
          branchList.local,
          curBranch,
          reviewKeys,
        );
        if (smartDefault) setCompareRef(smartDefault);
      })
      .catch((err) => {
        console.error("Failed to load branches:", err);
        setBranchesLocal({
          local: ["main", "master"],
          remote: [],
          stashes: [],
        });
        setBaseRef("main");
      })
      .finally(() => setBranchesLoading(false));
  }, [repoPath, branchesProp, defaultBranchProp, smartDefaultSet]);

  const handleStartReview = useCallback(() => {
    if (!baseRef || !compareRef) return;

    if (compareRef.startsWith(PR_PREFIX)) {
      const prNumber = parseInt(compareRef.slice(PR_PREFIX.length, -2), 10);
      const pr = pullRequests.find((p) => p.number === prNumber);
      if (pr) {
        const { comparison, githubPr } = makeComparisonFromPr(pr);
        onSelectReview(comparison, githubPr);
      }
      return;
    }

    const comparison = makeComparison(baseRef, compareRef);
    onSelectReview(comparison);
  }, [baseRef, compareRef, onSelectReview, pullRequests]);

  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && baseRef) {
        handleStartReview();
      }
    },
    [baseRef, handleStartReview],
  );

  const isInitialLoad = branchesLoading && !baseRef;

  return (
    <div onKeyDown={handleFormKeyDown}>
      {isInitialLoad ? (
        <div className="flex flex-nowrap items-center gap-3 rounded-xl border border-stone-800/60 bg-gradient-to-br from-stone-900/60 to-stone-950/80 px-5 py-4 shadow-inner shadow-black/20">
          <div className="h-9 w-[180px] bg-stone-800 rounded-lg animate-pulse" />
          <span className="text-stone-700 text-lg font-light select-none tracking-widest shrink-0">
            ..
          </span>
          <div className="h-9 w-[180px] bg-stone-800 rounded-lg animate-pulse" />
          <div className="flex-1" />
          <div className="h-9 w-20 bg-stone-800 rounded-lg animate-pulse" />
        </div>
      ) : (
        <div className="flex flex-nowrap items-center gap-3 rounded-xl border border-stone-800/60 bg-gradient-to-br from-stone-900/60 to-stone-950/80 px-5 py-4 shadow-inner shadow-black/20">
          <BranchSelect
            value={baseRef}
            onChange={(newBase) => {
              setBaseRef(newBase);
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
            baseValue={baseRef}
            existingComparisonKeys={existingComparisonKeys}
            placeholder="Compare\u2026"
            pullRequests={pullRequests}
          />

          <div className="flex-1" />

          <button
            onClick={handleStartReview}
            disabled={!baseRef || !compareRef || branchesLoading}
            className="group/btn btn-interactive relative shrink-0 rounded-lg bg-gradient-to-r from-sage-500 to-sage-400 px-5 py-2
                     text-sm font-semibold text-stone-950
                     transition-colors duration-200
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
      )}
    </div>
  );
}
