import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
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

  const githubPr = useReviewStore((s) => s.reviewState?.comparison?.githubPr);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto py-4">
        {/* PR Info */}
        {githubPr && (
          <div className="px-4 mb-4">
            <h1 className="text-lg font-semibold text-stone-200">
              {githubPr.title}{" "}
              <span className="text-stone-500 font-normal">
                #{githubPr.number}
              </span>
            </h1>
            <div className="text-xs text-stone-500 mt-1 font-mono">
              {githubPr.baseRefName} &larr; {githubPr.headRefName}
            </div>
            {githubPr.body && (
              <div className="mt-3 rounded-lg border border-stone-800 overflow-hidden">
                <div className="px-4 py-3">
                  <div className="guide-prose text-stone-300">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      urlTransform={(url) =>
                        url.startsWith("review://")
                          ? url
                          : defaultUrlTransform(url)
                      }
                      components={{
                        a: ({ href, children }) => (
                          <button
                            onClick={() => {
                              if (href) {
                                getPlatformServices().opener.openUrl(href);
                              }
                            }}
                            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 cursor-pointer"
                          >
                            {children}
                          </button>
                        ),
                      }}
                    >
                      {githubPr.body}
                    </Markdown>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Review */}
        <div className="px-4 mb-2">
          <h2 className="text-sm font-medium text-stone-400">Review</h2>
        </div>
        <SummaryStats
          totalHunks={totalHunks}
          trustedHunks={trustedHunks}
          approvedHunks={approvedHunks}
          rejectedHunks={rejectedHunks}
          pendingHunks={pendingHunks}
          reviewedPercent={reviewedPercent}
          state={state}
        />

        {/* AI Walkthrough */}
        <GuideOverviewSection />

        {/* Trust Patterns + Classification */}
        <TrustSection />

        {/* Changed Files — Files → Symbols → Hunks */}
        <DrillDownSection />
      </div>
    </div>
  );
}
