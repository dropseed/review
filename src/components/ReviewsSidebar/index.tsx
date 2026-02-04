import { useState, useEffect, useMemo, useCallback } from "react";
import type { Comparison, BranchList, PullRequest } from "../../types";
import { useReviewStore } from "../../stores";
import { usePrefersReducedMotion } from "../../hooks";
import { getApiClient } from "../../api";
import { SidebarDataProvider } from "./SidebarDataContext";
import { SidebarShell } from "./SidebarShell";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarFooter } from "./SidebarFooter";
import { WorkingTreeSection } from "./WorkingTreeSection";
import { SavedReviewsSection } from "./SavedReviewsSection";
import { QuickComparisonPicker } from "./QuickComparisonPicker";

interface ReviewsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectReview: (comparison: Comparison) => void;
  repoPath: string;
}

export function ReviewsSidebar({
  isOpen,
  onClose,
  onSelectReview,
  repoPath,
}: ReviewsSidebarProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Granular store selectors (no full store subscription)
  const savedReviews = useReviewStore((s) => s.savedReviews);
  const savedReviewsLoading = useReviewStore((s) => s.savedReviewsLoading);
  const loadSavedReviews = useReviewStore((s) => s.loadSavedReviews);
  const gitStatus = useReviewStore((s) => s.gitStatus);
  const loadGitStatus = useReviewStore((s) => s.loadGitStatus);
  const loadRemoteInfo = useReviewStore((s) => s.loadRemoteInfo);

  // Local state for sidebar-specific data
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("HEAD");

  // Progressive data loading
  useEffect(() => {
    if (!isOpen) return;

    // Phase 1: Critical data (shows immediately)
    const frame = requestAnimationFrame(() => {
      loadGitStatus();
      loadRemoteInfo();
      loadSavedReviews();
    });

    // Phase 2: Secondary data (for new review picker)
    const timeout = setTimeout(() => {
      const client = getApiClient();

      // Load branches
      client
        .listBranches(repoPath)
        .then(setBranches)
        .catch(() =>
          setBranches({ local: ["main", "master"], remote: [], stashes: [] }),
        );

      // Load default branch
      client
        .getDefaultBranch(repoPath)
        .then(setDefaultBranch)
        .catch(() => setDefaultBranch("main"));

      // Load current branch
      client
        .getCurrentBranch(repoPath)
        .then(setCurrentBranch)
        .catch(() => setCurrentBranch("HEAD"));

      // Load PRs (non-blocking)
      client
        .checkGitHubAvailable(repoPath)
        .then((avail) => (avail ? client.listPullRequests(repoPath) : []))
        .then(setPullRequests)
        .catch(() => setPullRequests([]));
    }, 50); // Small delay to prioritize animation

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [isOpen, loadGitStatus, loadRemoteInfo, loadSavedReviews, repoPath]);

  // Filter out working tree reviews from the Continue list
  const nonWorkingTreeReviews = useMemo(
    () => savedReviews.filter((r) => !r.comparison.workingTree),
    [savedReviews],
  );

  const existingComparisonKeys = useMemo(
    () => savedReviews.map((r) => r.comparison.key),
    [savedReviews],
  );

  // Handle selecting a review - close sidebar and pass to parent
  const handleSelectReview = useCallback(
    (comparison: Comparison) => {
      onSelectReview(comparison);
      onClose();
    },
    [onSelectReview, onClose],
  );

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      gitStatus,
      savedReviews,
      branches,
      defaultBranch,
      pullRequests,
      currentBranch,
      nonWorkingTreeReviews,
      existingComparisonKeys,
      isLoadingCritical: savedReviewsLoading || !gitStatus,
      isLoadingBranches: !branches,
      onSelectReview: handleSelectReview,
      onClose,
      prefersReducedMotion,
    }),
    [
      gitStatus,
      savedReviews,
      branches,
      defaultBranch,
      pullRequests,
      currentBranch,
      nonWorkingTreeReviews,
      existingComparisonKeys,
      savedReviewsLoading,
      handleSelectReview,
      onClose,
      prefersReducedMotion,
    ],
  );

  return (
    <SidebarShell
      isOpen={isOpen}
      onClose={onClose}
      prefersReducedMotion={prefersReducedMotion}
    >
      <SidebarDataProvider value={contextValue}>
        <SidebarHeader />
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          <WorkingTreeSection />
          <SavedReviewsSection />
          <QuickComparisonPicker />
        </div>
        <SidebarFooter />
      </SidebarDataProvider>
    </SidebarShell>
  );
}

export { ReviewsSidebarToggle } from "./ReviewsSidebarToggle";
