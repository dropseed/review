import { useReviewProgress } from "../../hooks/useReviewProgress";
import { SummaryStats } from "./SummaryStats";
import { TrustSection } from "./TrustSection";
import { DrillDownSection } from "./DrillDownSection";

export function OverviewView() {
  const {
    totalHunks,
    trustedHunks,
    approvedHunks,
    pendingHunks,
    reviewedPercent,
  } = useReviewProgress();

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto py-4">
        {/* Section 1: Summary Stats */}
        <SummaryStats
          totalHunks={totalHunks}
          trustedHunks={trustedHunks}
          approvedHunks={approvedHunks}
          pendingHunks={pendingHunks}
          reviewedPercent={reviewedPercent}
        />

        {/* Section 2: Trust Patterns + Classification */}
        <TrustSection />

        {/* Section 3: Drill-Down — Files → Symbols → Hunks */}
        <DrillDownSection />
      </div>
    </div>
  );
}
