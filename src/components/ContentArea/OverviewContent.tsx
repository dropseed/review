import type { ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewStore } from "../../stores";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { getPlatformServices } from "../../platform";
import { StructuredDiagram } from "../GuideView/StructuredDiagram";
import { SummaryStats } from "../GuideView/SummaryStats";
import { CopyErrorButton } from "../GuideView/CopyErrorButton";
import { SummaryFileTree } from "../GuideView/SummaryFileTree";

function Spinner({ className = "h-4 w-4" }: { className?: string }): ReactNode {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function SparkleIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}): ReactNode {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

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

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <div className="rounded-lg border border-status-rejected/50 bg-status-rejected/10 p-4">
      <p className="text-xs text-status-rejected">{message}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={onRetry}
          className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
        >
          Retry
        </button>
        <CopyErrorButton error={message} />
      </div>
    </div>
  );
}

function SummarySection(): ReactNode {
  const guideSummary = useReviewStore((s) => s.guideSummary);
  const guideSummaryError = useReviewStore((s) => s.guideSummaryError);
  const summaryStatus = useReviewStore((s) => s.summaryStatus);
  const isSummaryStale = useReviewStore((s) => s.isSummaryStale);
  const generateSummary = useReviewStore((s) => s.generateSummary);
  const prBody = useReviewStore((s) => s.reviewState?.githubPr?.body);

  const displaySummary = guideSummary || prBody || null;
  const stale = guideSummary ? isSummaryStale() : false;
  const showCta =
    !displaySummary && !guideSummaryError && summaryStatus !== "loading";

  return (
    <div className="space-y-4">
      {summaryStatus === "loading" && !displaySummary && !guideSummaryError && (
        <div className="rounded-lg border border-edge p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Spinner />
            <span className="text-xs">Generating summary…</span>
          </div>
        </div>
      )}
      {guideSummaryError && (
        <ErrorPanel
          message={`Failed to generate summary: ${guideSummaryError}`}
          onRetry={() => generateSummary()}
        />
      )}
      {showCta && (
        <div className="rounded-lg border border-edge-default/60 overflow-hidden bg-surface-panel">
          <div className="flex items-center w-full gap-3 px-3.5 py-3 bg-surface-raised/40">
            <SparkleIcon className="h-4 w-4 text-status-classifying" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-fg-secondary">
                AI Summary
              </span>
              <p className="text-xs text-fg-muted mt-0.5">
                Generate a summary of the changes in this review
              </p>
            </div>
            <button
              onClick={() => generateSummary()}
              className="flex-shrink-0 rounded-md bg-surface-raised/80 px-2.5 py-1 text-2xs text-fg-muted inset-ring-1 inset-ring-edge-default/50 hover:bg-surface-hover/80 hover:text-fg-secondary transition-colors"
            >
              Generate
            </button>
          </div>
        </div>
      )}
      {displaySummary && (
        <div>
          <div className="guide-prose text-sm text-fg-secondary leading-relaxed">
            <Markdown
              remarkPlugins={[remarkGfm]}
              urlTransform={urlTransform}
              components={markdownComponents}
            >
              {displaySummary}
            </Markdown>
          </div>
          {stale && !prBody && (
            <div className="flex items-center justify-end mt-2">
              <button
                onClick={() => generateSummary()}
                className="flex items-center gap-1 rounded-full bg-status-modified/15 px-2 py-0.5 text-xxs font-medium text-status-modified hover:bg-status-modified/25 transition-colors"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}
      <DiagramSection />
    </div>
  );
}

function DiagramSection(): ReactNode {
  const guideDiagram = useReviewStore((s) => s.guideDiagram);
  const guideDiagramError = useReviewStore((s) => s.guideDiagramError);
  const diagramStatus = useReviewStore((s) => s.diagramStatus);
  const isSummaryStale = useReviewStore((s) => s.isSummaryStale);
  const generateDiagram = useReviewStore((s) => s.generateDiagram);

  const stale = guideDiagram ? isSummaryStale() : false;
  const isValidJson = guideDiagram?.trimStart().startsWith("{") ?? false;
  const skipped =
    !guideDiagram && !guideDiagramError && diagramStatus === "done";

  if (!guideDiagram && !guideDiagramError && diagramStatus === "idle")
    return null;

  return (
    <div className="space-y-4">
      {diagramStatus === "loading" && !guideDiagram && !guideDiagramError && (
        <div className="rounded-lg border border-edge p-4">
          <div className="flex items-center gap-2 text-fg-muted">
            <Spinner />
            <span className="text-xs">Generating diagram…</span>
          </div>
        </div>
      )}
      {skipped && (
        <div className="rounded-lg border border-edge/50 p-3">
          <p className="text-xxs text-fg-faint">
            Diagram was skipped for this review.
          </p>
        </div>
      )}
      {guideDiagramError && (
        <ErrorPanel
          message={`Failed to generate diagram: ${guideDiagramError}`}
          onRetry={() => generateDiagram()}
        />
      )}
      {guideDiagram && !isValidJson && (
        <div className="rounded-lg border border-edge p-4">
          <p className="text-xs text-fg-muted">Diagram format has changed.</p>
          <button
            onClick={() => generateDiagram()}
            className="mt-2 text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
          >
            Regenerate
          </button>
        </div>
      )}
      {guideDiagram && isValidJson && (
        <div className="rounded-lg overflow-hidden">
          <StructuredDiagram
            sceneJson={guideDiagram}
            onRetry={() => generateDiagram()}
          />
          {stale && (
            <div className="flex items-center justify-end px-4 pb-3">
              <button
                onClick={() => generateDiagram()}
                className="flex items-center gap-1 rounded-full bg-status-modified/15 px-2 py-0.5 text-xxs font-medium text-status-modified hover:bg-status-modified/25 transition-colors"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OverviewContent(): ReactNode {
  const progress = useReviewProgress();
  const githubPr = useReviewStore((s) => s.reviewState?.githubPr);
  const guideTitle = useReviewStore((s) => s.guideTitle);
  const displayTitle = githubPr?.title || guideTitle;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl w-full mx-auto px-4 py-4">
          {displayTitle && (
            <h1 className="text-lg font-semibold text-fg mb-2">
              {displayTitle}
            </h1>
          )}
          <SummaryStats {...progress} />
          <div className="mt-5 space-y-5">
            <SummarySection />
            <SummaryFileTree />
          </div>
        </div>
      </div>
    </div>
  );
}
