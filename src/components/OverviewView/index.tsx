import { useReviewProgress } from "../../hooks/useReviewProgress";
import { SummaryStats } from "./SummaryStats";
import { GuideOverviewSection } from "./GuideOverviewSection";
import { TrustSection } from "./TrustSection";
import { DrillDownSection } from "./DrillDownSection";

export function OverviewView() {
  const {
    totalHunks,
    trustedHunks,
    approvedHunks,
    rejectedHunks,
    pendingHunks,
    reviewedPercent,
    state,
  } = useReviewProgress();

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto py-4">
        {/* Narrative: PR Description + AI Walkthrough */}
        <GuideOverviewSection />

        {/* Review Progress */}
        <SummaryStats
          totalHunks={totalHunks}
          trustedHunks={trustedHunks}
          approvedHunks={approvedHunks}
          rejectedHunks={rejectedHunks}
          pendingHunks={pendingHunks}
          reviewedPercent={reviewedPercent}
          state={state}
        />

        {/* Trust Patterns + Classification */}
        <TrustSection />

        {/* Changed Files — Files → Symbols → Hunks */}
        <DrillDownSection />
      </div>
    </div>
  );
}
