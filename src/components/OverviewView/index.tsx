import type { ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { SummaryStats } from "./SummaryStats";
import { GuideOverviewSection } from "./GuideOverviewSection";
import { TrustSection } from "./TrustSection";
import { DrillDownSection } from "./DrillDownSection";

function DiffLinePlaceholder({ lineNumber }: { lineNumber: number }) {
  return (
    <div className="flex gap-2 items-center">
      <span className="w-4 text-right font-mono text-xxs text-stone-600">
        {lineNumber}
      </span>
      <div className="h-px flex-1 bg-stone-700" />
    </div>
  );
}

/**
 * Empty state shown when there are no changes in the current comparison.
 * Prompts the user to switch comparison via the tab rail.
 */
function NoChangesPrompt() {
  return (
    <div className="flex-1 flex items-center justify-center pb-16">
      <div className="flex flex-col items-center max-w-sm">
        {/* Diff placeholder illustration */}
        <div className="mb-6 w-40 space-y-1.5 opacity-30">
          <DiffLinePlaceholder lineNumber={1} />
          <DiffLinePlaceholder lineNumber={2} />
          <DiffLinePlaceholder lineNumber={3} />
        </div>

        <h3 className="text-sm font-medium text-stone-300 mb-2">
          No changes to review
        </h3>
        <p className="text-xs text-stone-500 text-center mb-5">
          The base and compare refs are identical, or no diff hunks were found.
        </p>
        <p className="text-xs text-stone-600 text-center">
          Right-click a tab in the sidebar to switch comparison, or open a
          different repository.
        </p>
      </div>
    </div>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) {
          getPlatformServices().opener.openUrl(href);
        }
      }}
      className="text-cyan-400 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/50 rounded underline underline-offset-2 cursor-pointer"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

function urlTransform(url: string): string {
  return url.startsWith("review://") ? url : defaultUrlTransform(url);
}

const markdownComponents = {
  a: ExternalLink,
};

export function OverviewView() {
  const progress = useReviewProgress();
  const githubPr = useReviewStore((s) => s.reviewState?.comparison?.githubPr);
  const loadingProgress = useReviewStore((s) => s.loadingProgress);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col">
      <div className="max-w-5xl w-full mx-auto py-4">
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
                      urlTransform={urlTransform}
                      components={markdownComponents}
                    >
                      {githubPr.body}
                    </Markdown>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {progress.totalHunks === 0 && loadingProgress ? (
        /* Spacer while files are still loading */
        <div className="flex-1" />
      ) : progress.totalHunks === 0 ? (
        <NoChangesPrompt />
      ) : (
        <div className="max-w-5xl w-full mx-auto">
          <div className="px-4 mb-2">
            <h2 className="text-sm font-medium text-stone-400">Review</h2>
          </div>
          <SummaryStats {...progress} />

          <GuideOverviewSection />
          <TrustSection />
          <DrillDownSection />
        </div>
      )}
    </div>
  );
}
