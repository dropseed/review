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
 * Prompts the user to switch to a different comparison via the reviews sidebar.
 */
function NoChangesPrompt() {
  const setReviewsSidebarOpen = useReviewStore((s) => s.setReviewsSidebarOpen);

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

        {/* Prompt card to switch comparison */}
        <button
          onClick={() => setReviewsSidebarOpen(true)}
          className="group flex items-center gap-3 rounded-lg border border-stone-800/80
                     bg-gradient-to-br from-stone-900/60 to-stone-900/40
                     px-5 py-3.5 text-left
                     transition-all duration-200
                     hover:border-amber-500/30 hover:from-stone-900 hover:to-stone-900/60
                     hover:shadow-lg hover:shadow-amber-900/10 hover:-translate-y-0.5
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
        >
          {/* Icon */}
          <div className="shrink-0 w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <svg
              className="w-4.5 h-4.5 text-amber-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-stone-200">
              Switch comparison
            </span>
            <span className="block text-xs text-stone-500 mt-0.5">
              Review a different branch or pull request
            </span>
          </div>

          {/* Arrow */}
          <svg
            className="w-4 h-4 text-stone-600 group-hover:text-stone-400 transition-colors"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Keyboard hint */}
        <p className="mt-4 text-xxs text-stone-600 flex items-center gap-1.5">
          <kbd className="inline-flex items-center gap-0.5 rounded border border-stone-800/80 bg-stone-800 px-1 py-0.5 font-mono text-xxs text-stone-500">
            <span>{"\u2318"}</span>
            <span>E</span>
          </kbd>
          <span>to open comparison selector</span>
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

      {progress.totalHunks === 0 ? (
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
