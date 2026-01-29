import { useReviewStore } from "../../stores/reviewStore";
import { isHunkTrusted } from "../../types";
import { SummaryStats } from "./SummaryStats";
import { TrustSection } from "./TrustSection";
import { DrillDownSection } from "./DrillDownSection";

export function OverviewView() {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);

  // Global progress
  const totalHunks = hunks.length;
  const trustedHunks = reviewState
    ? hunks.filter((h) => {
        const state = reviewState.hunks[h.id];
        return !state?.status && isHunkTrusted(state, reviewState.trustList);
      }).length
    : 0;
  const approvedHunks = reviewState
    ? hunks.filter((h) => reviewState.hunks[h.id]?.status === "approved").length
    : 0;
  const pendingHunks = totalHunks - trustedHunks - approvedHunks;
  const reviewedPercent =
    totalHunks > 0
      ? Math.round(((trustedHunks + approvedHunks) / totalHunks) * 100)
      : 0;

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
