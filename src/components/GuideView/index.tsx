import { type ReactNode, useEffect, useRef, useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { SummaryStats } from "./SummaryStats";
import { OverviewSection } from "./OverviewSection";
import { QuickWinsSection } from "./QuickWinsSection";
import {
  FocusedReviewSection,
  useFocusedReviewUnreviewed,
} from "./FocusedReviewSection";
import { DrillDownSection } from "./DrillDownSection";

function SummarySection() {
  const guideSummary = useReviewStore((s) => s.guideSummary);
  const guideSummaryError = useReviewStore((s) => s.guideSummaryError);
  const summaryStatus = useReviewStore((s) => s.summaryStatus);
  const isSummaryStale = useReviewStore((s) => s.isSummaryStale);
  const generateSummary = useReviewStore((s) => s.generateSummary);

  const stale = guideSummary ? isSummaryStale() : false;

  return (
    <div className="space-y-4">
      {summaryStatus === "loading" && !guideSummary && !guideSummaryError && (
        <div className="rounded-lg border border-stone-800 p-4">
          <div className="flex items-center gap-2 text-stone-500">
            <svg
              className="h-4 w-4 animate-spin"
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
            <span className="text-xs">Generating summary…</span>
          </div>
        </div>
      )}
      {guideSummaryError && (
        <div className="rounded-lg border border-rose-800/50 bg-rose-950/20 p-4">
          <p className="text-xs text-rose-400">
            Failed to generate summary: {guideSummaryError}
          </p>
        </div>
      )}
      {guideSummary && (
        <div className="rounded-lg border border-stone-800 p-4">
          <p className="text-sm text-stone-300 leading-relaxed">
            {guideSummary}
          </p>
          {stale && (
            <div className="flex items-center justify-end mt-2">
              <button
                onClick={() => generateSummary()}
                className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xxs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}
      <OverviewSection />
    </div>
  );
}

function GuideProgressBar() {
  const classificationStatus = useReviewStore((s) => s.classificationStatus);
  const groupingStatus = useReviewStore((s) => s.groupingStatus);
  const summaryStatus = useReviewStore((s) => s.summaryStatus);

  // Hide when all idle (guide hasn't been started)
  if (
    classificationStatus === "idle" &&
    groupingStatus === "idle" &&
    summaryStatus === "idle"
  ) {
    return null;
  }

  const tasks = [
    { label: "Classification", status: classificationStatus },
    { label: "Grouping", status: groupingStatus },
    { label: "Summary", status: summaryStatus },
  ];

  return (
    <div className="flex items-center gap-4 px-4 py-1.5">
      {tasks.map((task) => {
        if (task.status === "idle") return null;
        return (
          <span key={task.label} className="flex items-center gap-1.5 text-xxs">
            {task.status === "loading" && (
              <svg
                className="h-3 w-3 animate-spin text-stone-500"
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
            )}
            {task.status === "done" && (
              <svg
                className="h-3 w-3 text-emerald-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            {task.status === "error" && (
              <svg
                className="h-3 w-3 text-rose-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
            <span
              className={
                task.status === "loading"
                  ? "text-stone-400"
                  : task.status === "done"
                    ? "text-emerald-400"
                    : "text-rose-400"
              }
            >
              {task.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

interface SectionConfig {
  id: string;
  title: string;
  component: () => ReactNode;
}

const SECTIONS: SectionConfig[] = [
  { id: "overview", title: "Summary", component: () => <SummarySection /> },
  { id: "quick-wins", title: "Trust", component: () => <QuickWinsSection /> },
  {
    id: "focused-review",
    title: "Guided Review",
    component: () => <FocusedReviewSection />,
  },
  {
    id: "changed-files",
    title: "Remaining Files",
    component: () => <DrillDownSection />,
  },
];

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

function NoChangesPrompt() {
  return (
    <div className="flex-1 flex items-center justify-center pb-16">
      <div className="flex flex-col items-center max-w-sm">
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

function CheckIcon() {
  return (
    <svg
      className="w-3 h-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function getTabClasses(isActive: boolean, completed: boolean): string {
  const base =
    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors";

  if (isActive) {
    return `${base} bg-amber-500/15 text-amber-400`;
  }

  if (completed) {
    return `${base} text-stone-500 hover:text-stone-300 hover:bg-stone-800/50`;
  }

  return `${base} text-stone-400 hover:text-stone-200 hover:bg-stone-800/50`;
}

function getContentState(
  totalHunks: number,
  isLoading: boolean,
): "loading" | "empty" | "content" {
  if (totalHunks === 0 && isLoading) return "loading";
  if (totalHunks === 0) return "empty";
  return "content";
}

export function GuideView() {
  const progress = useReviewProgress();
  const githubPr = useReviewStore((s) => s.reviewState?.comparison?.githubPr);
  const loadingProgress = useReviewStore((s) => s.loadingProgress);

  const activeTab = useReviewStore((s) => s.guideActiveTab);
  const setActiveTab = useReviewStore((s) => s.setGuideActiveTab);

  const focusedReviewUnreviewed = useFocusedReviewUnreviewed();

  const completedSections = useMemo(
    () =>
      new Set(
        [
          focusedReviewUnreviewed === 0 &&
            focusedReviewUnreviewed !== undefined &&
            "focused-review",
        ].filter(Boolean),
      ),
    [focusedReviewUnreviewed],
  );

  // Auto-advance to the next incomplete tab when the current one completes
  const prevCompleted = useRef(completedSections);
  useEffect(() => {
    const prev = prevCompleted.current;
    prevCompleted.current = completedSections;

    if (completedSections.has(activeTab) && !prev.has(activeTab)) {
      const currentIndex = SECTIONS.findIndex((s) => s.id === activeTab);
      const nextIncomplete = SECTIONS.find(
        (s, i) => i > currentIndex && !completedSections.has(s.id),
      );
      if (nextIncomplete) {
        const timer = setTimeout(() => {
          setActiveTab(nextIncomplete.id);
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [completedSections, activeTab]);

  const contentState = getContentState(progress.totalHunks, !!loadingProgress);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* PR Context */}
      <div className="max-w-5xl w-full mx-auto py-4 shrink-0">
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

      {contentState === "loading" && <div className="flex-1" />}
      {contentState === "empty" && <NoChangesPrompt />}
      {contentState === "content" && (
        <>
          <div className="sticky top-0 z-20 bg-stone-900/95 backdrop-blur-sm border-b border-stone-800/50 shrink-0">
            <div className="max-w-5xl w-full mx-auto">
              <SummaryStats {...progress} />
              <GuideProgressBar />
            </div>
          </div>

          {/* Tab bar */}
          <div className="bg-stone-900/95 backdrop-blur-sm border-b border-stone-800/50 shrink-0">
            <div className="max-w-5xl w-full mx-auto px-4 py-2 flex items-center gap-1 overflow-x-auto scrollbar-none">
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveTab(section.id)}
                  className={getTabClasses(
                    activeTab === section.id,
                    completedSections.has(section.id),
                  )}
                >
                  {completedSections.has(section.id) && (
                    <span className="text-emerald-400">
                      <CheckIcon />
                    </span>
                  )}
                  {section.title}
                </button>
              ))}
            </div>
          </div>

          {/* Active tab panel */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div key={activeTab} className="max-w-5xl w-full mx-auto px-4 py-4">
              {SECTIONS.find((s) => s.id === activeTab)?.component()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
