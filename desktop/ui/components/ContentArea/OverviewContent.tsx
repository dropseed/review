import type { ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewStore } from "../../stores";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { getPlatformServices } from "../../platform";
import { SummaryStats } from "../GuideView/SummaryStats";
import { SummaryFileTree } from "../GuideView/SummaryFileTree";

function ExternalLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) getPlatformServices().opener.openUrl(href);
      }}
      className="text-link hover:text-link/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-link/50 rounded underline underline-offset-2 cursor-pointer"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

function urlTransform(url: string): string {
  return url.startsWith("review://") ? url : defaultUrlTransform(url);
}

const markdownComponents = { a: ExternalLink };

function PrBodySection(): ReactNode {
  const prBody = useReviewStore((s) => s.reviewState?.githubPr?.body);
  if (!prBody) return null;

  return (
    <div className="guide-prose text-sm text-fg-secondary leading-relaxed">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={markdownComponents}
      >
        {prBody}
      </Markdown>
    </div>
  );
}

export function OverviewContent(): ReactNode {
  const comparison = useReviewStore((s) => s.comparison);
  const progress = useReviewProgress();
  const githubPrTitle = useReviewStore((s) => s.reviewState?.githubPr?.title);

  // Browse mode: no comparison set
  if (!comparison) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center overflow-hidden">
        <div className="flex flex-col items-center animate-fade-in">
          <p className="text-sm text-fg-muted">
            Select a file to view its contents
          </p>
        </div>
      </div>
    );
  }

  if (progress.totalHunks === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center overflow-hidden">
        <div className="flex flex-col items-center animate-fade-in">
          <div className="relative mb-6">
            <div className="flex items-center gap-3">
              <div className="w-11 h-[3.5rem] rounded-md bg-surface-raised/60 border border-edge-default/40" />
              <div className="flex flex-col gap-[3px]">
                <div className="w-2.5 h-px bg-fg-faint/50 rounded-full" />
                <div className="w-2.5 h-px bg-fg-faint/50 rounded-full" />
              </div>
              <div className="w-11 h-[3.5rem] rounded-md bg-surface-raised/60 border border-edge-default/40" />
            </div>
          </div>
          <p className="text-sm font-medium text-fg-muted mb-1">
            Nothing to review
          </p>
          <p className="text-xs text-fg-faint text-center max-w-[220px] leading-relaxed">
            No differences between the base and compare refs
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl w-full mx-auto px-4 py-4">
          {githubPrTitle && (
            <h1 className="text-lg font-semibold text-fg mb-2">
              {githubPrTitle}
            </h1>
          )}
          <SummaryStats {...progress} />
          <div className="mt-5 space-y-5">
            <PrBodySection />
            <SummaryFileTree />
          </div>
        </div>
      </div>
    </div>
  );
}
