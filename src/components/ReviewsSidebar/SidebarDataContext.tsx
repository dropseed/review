import { createContext, useContext } from "react";
import type {
  Comparison,
  GitStatusSummary,
  ReviewSummary,
  BranchList,
  PullRequest,
} from "../../types";

export interface SidebarDataContextValue {
  // Data
  gitStatus: GitStatusSummary | null;
  savedReviews: ReviewSummary[];
  branches: BranchList | null;
  defaultBranch: string | null;
  pullRequests: PullRequest[];
  currentBranch: string;

  // Computed
  nonWorkingTreeReviews: ReviewSummary[];
  existingComparisonKeys: string[];

  // Loading states
  isLoadingCritical: boolean;
  isLoadingBranches: boolean;

  // Callbacks
  onSelectReview: (comparison: Comparison) => void;
  onClose: () => void;

  // Preferences
  prefersReducedMotion: boolean;
}

const SidebarDataContext = createContext<SidebarDataContextValue | null>(null);

export function useSidebarData(): SidebarDataContextValue {
  const context = useContext(SidebarDataContext);
  if (!context) {
    throw new Error("useSidebarData must be used within SidebarDataProvider");
  }
  return context;
}

export const SidebarDataProvider = SidebarDataContext.Provider;
