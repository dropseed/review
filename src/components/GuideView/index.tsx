import { type ReactNode, useCallback, useEffect, useRef, useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { useTrustCounts } from "../../hooks/useTrustCounts";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { calculateFileHunkStatus } from "../FilesPanel/FileTree.utils";
import { SummaryStats } from "./SummaryStats";
import { OverviewSection } from "./OverviewSection";
import { QuickWinsSection } from "./QuickWinsSection";
import {
  FocusedReviewSection,
  useFocusedReviewUnreviewed,
} from "./FocusedReviewSection";
import { DrillDownSection } from "./DrillDownSection";

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
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

function NextStepCta({
  message,
  targetTab,
}: {
  message: string;
  targetTab: string;
}) {
  const setActiveTab = useReviewStore((s) => s.setGuideActiveTab);
  return (
    <button
      type="button"
      onClick={() => setActiveTab(targetTab)}
      className="group flex items-center gap-2 w-full rounded-lg border border-stone-700/50 px-4 py-3 mt-4 text-left hover:border-stone-600 hover:bg-stone-800/30 transition-colors"
    >
      <span className="text-xs text-stone-400 group-hover:text-stone-300 transition-colors">
        {message}
      </span>
      <svg
        className="w-3.5 h-3.5 text-stone-600 group-hover:text-stone-400 transition-colors ml-auto shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 7l5 5m0 0l-5 5m5-5H6"
        />
      </svg>
    </button>
  );
}

function SummarySection() {
  const guideSummary = useReviewStore((s) => s.guideSummary);
  const guideSummaryError = useReviewStore((s) => s.guideSummaryError);
  const summaryStatus = useReviewStore((s) => s.summaryStatus);
  const isSummaryStale = useReviewStore((s) => s.isSummaryStale);
  const generateSummary = useReviewStore((s) => s.generateSummary);
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);

  const stale = guideSummary ? isSummaryStale() : false;
  const showCta =
    !guideSummary &&
    !guideSummaryError &&
    summaryStatus !== "loading" &&
    claudeAvailable !== false;

  return (
    <div className="space-y-4">
      {summaryStatus === "loading" && !guideSummary && !guideSummaryError && (
        <div className="rounded-lg border border-stone-800 p-4">
          <div className="flex items-center gap-2 text-stone-500">
            <Spinner />
            <span className="text-xs">Generating summary…</span>
          </div>
        </div>
      )}
      {guideSummaryError && (
        <div className="rounded-lg border border-rose-800/50 bg-rose-950/20 p-4">
          <p className="text-xs text-rose-400">
            Failed to generate summary: {guideSummaryError}
          </p>
          <button
            onClick={() => generateSummary()}
            className="mt-2 text-xxs text-stone-400 hover:text-stone-200 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      {showCta && (
        <div className="rounded-lg border border-stone-700/60 overflow-hidden bg-stone-900">
          <div className="flex items-center w-full gap-3 px-3.5 py-3 bg-stone-800/40">
            <SparkleIcon className="h-4 w-4 text-purple-400" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-stone-300">
                AI Summary
              </span>
              <p className="text-xs text-stone-500 mt-0.5">
                Generate a summary of the changes in this review
              </p>
            </div>
            <button
              onClick={() => generateSummary()}
              className="flex-shrink-0 rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors"
            >
              Generate
            </button>
          </div>
        </div>
      )}
      {guideSummary && (
        <div className="rounded-lg border border-stone-800 p-4">
          <div className="guide-prose text-sm text-stone-300 leading-relaxed">
            <Markdown
              remarkPlugins={[remarkGfm]}
              urlTransform={urlTransform}
              components={markdownComponents}
            >
              {guideSummary}
            </Markdown>
          </div>
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
      <NextStepCta message="Start reviewing" targetTab="quick-wins" />
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

function SparkleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function TabBadge({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "amber" | "cyan" | "emerald";
}) {
  const colors = {
    amber: "bg-amber-500/15 text-amber-400",
    cyan: "bg-cyan-500/15 text-cyan-400",
    emerald: "bg-emerald-500/15 text-emerald-400",
  };
  return (
    <span
      className={`text-xxs font-medium tabular-nums px-1.5 py-px rounded-full ${colors[variant]}`}
    >
      {children}
    </span>
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

interface TabBadgeInfo {
  sectionId: string;
  isCompleted: boolean;
  isLoading: boolean;
  guideSummary: string | null;
  trustedHunkCount: number;
  totalHunks: number;
  focusedReviewUnreviewed: number;
  filesPendingCount: number;
}

function getTabBadge({
  sectionId,
  isCompleted,
  isLoading,
  guideSummary,
  trustedHunkCount,
  totalHunks,
  focusedReviewUnreviewed,
  filesPendingCount,
}: TabBadgeInfo): ReactNode {
  if (isLoading) return null;

  switch (sectionId) {
    case "overview":
      if (guideSummary) {
        return (
          <span className="text-purple-400">
            <SparkleIcon className="h-3 w-3" />
          </span>
        );
      }
      return null;

    case "quick-wins":
      if (isCompleted) {
        return (
          <span className="text-emerald-400">
            <CheckIcon />
          </span>
        );
      }
      if (totalHunks > 0) {
        return (
          <TabBadge variant="cyan">
            {trustedHunkCount}/{totalHunks}
          </TabBadge>
        );
      }
      return null;

    case "focused-review":
      if (isCompleted) {
        return (
          <span className="text-emerald-400">
            <CheckIcon />
          </span>
        );
      }
      if (focusedReviewUnreviewed > 0) {
        return <TabBadge variant="amber">{focusedReviewUnreviewed}</TabBadge>;
      }
      return null;

    case "changed-files":
      if (isCompleted) {
        return (
          <span className="text-emerald-400">
            <CheckIcon />
          </span>
        );
      }
      if (filesPendingCount > 0) {
        return <TabBadge variant="amber">{filesPendingCount}</TabBadge>;
      }
      return null;

    default:
      return null;
  }
}

export function GuideView(): ReactNode {
  const progress = useReviewProgress();
  const githubPr = useReviewStore((s) => s.reviewState?.comparison?.githubPr);
  const loadingProgress = useReviewStore((s) => s.loadingProgress);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const guideSummary = useReviewStore((s) => s.guideSummary);

  const activeTab = useReviewStore((s) => s.guideActiveTab);
  const setActiveTab = useReviewStore((s) => s.setGuideActiveTab);

  const classificationStatus = useReviewStore((s) => s.classificationStatus);
  const groupingStatus = useReviewStore((s) => s.groupingStatus);
  const summaryStatus = useReviewStore((s) => s.summaryStatus);

  const focusedReviewUnreviewed = useFocusedReviewUnreviewed();
  const reviewGroups = useReviewStore((s) => s.reviewGroups);
  const { trustedHunkCount, totalHunks } = useTrustCounts();

  // Count files with pending hunks for Remaining Files badge
  const fileHunkStatusMap = useMemo(
    () => calculateFileHunkStatus(hunks, reviewState),
    [hunks, reviewState],
  );
  const filesPendingCount = useMemo(() => {
    let count = 0;
    for (const status of fileHunkStatusMap.values()) {
      if (status.pending > 0) count++;
    }
    return count;
  }, [fileHunkStatusMap]);

  const completedSections = useMemo(() => {
    const sections = new Set<string>();
    if (focusedReviewUnreviewed === 0 && reviewGroups.length > 0) {
      sections.add("focused-review");
    }
    if (progress.pendingHunks === 0 && progress.totalHunks > 0) {
      sections.add("quick-wins");
    }
    if (filesPendingCount === 0 && progress.totalHunks > 0) {
      sections.add("changed-files");
    }
    return sections;
  }, [
    focusedReviewUnreviewed,
    reviewGroups.length,
    progress.pendingHunks,
    progress.totalHunks,
    filesPendingCount,
  ]);

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
  }, [completedSections, activeTab, setActiveTab]);

  const isTabLoading = useCallback(
    (sectionId: string): boolean => {
      switch (sectionId) {
        case "overview":
          return summaryStatus === "loading";
        case "quick-wins":
          return classificationStatus === "loading";
        case "focused-review":
          return groupingStatus === "loading";
        default:
          return false;
      }
    },
    [summaryStatus, classificationStatus, groupingStatus],
  );

  const contentState = getContentState(progress.totalHunks, !!loadingProgress);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* PR Context */}
      <div className="max-w-5xl w-full mx-auto pt-4 pb-2 shrink-0">
        {githubPr && (
          <div className="px-4">
            <h1 className="text-base font-semibold text-stone-200 leading-snug">
              {githubPr.title}
              <span className="text-stone-600 font-normal ml-2 text-sm">
                #{githubPr.number}
              </span>
            </h1>
            <div className="flex items-center gap-1.5 mt-1 text-xxs font-mono text-stone-500">
              <span className="truncate">{githubPr.headRefName}</span>
              <span className="text-stone-600 shrink-0">&rarr;</span>
              <span className="truncate">{githubPr.baseRefName}</span>
            </div>
            {githubPr.body && (
              <div className="mt-3 rounded-lg border-l-2 border-stone-700 bg-stone-800/20 px-4 py-3">
                <div className="guide-prose text-stone-400">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={urlTransform}
                    components={markdownComponents}
                  >
                    {githubPr.body}
                  </Markdown>
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
          {/* Progress + tabs */}
          <div className="sticky top-0 z-20 bg-stone-900/95 backdrop-blur-sm border-b border-stone-800/50 shrink-0">
            <div className="max-w-5xl w-full mx-auto">
              <SummaryStats {...progress} />
              <div className="px-4 pt-2 pb-2 flex items-center gap-1">
                {SECTIONS.map((section) => {
                  const loading = isTabLoading(section.id);
                  const isCompleted = completedSections.has(section.id);
                  const badge = getTabBadge({
                    sectionId: section.id,
                    isCompleted,
                    isLoading: loading,
                    guideSummary,
                    trustedHunkCount,
                    totalHunks,
                    focusedReviewUnreviewed,
                    filesPendingCount,
                  });

                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveTab(section.id)}
                      className={getTabClasses(
                        activeTab === section.id,
                        isCompleted,
                      )}
                    >
                      {loading && <Spinner className="h-3 w-3" />}
                      {section.title}
                      {badge}
                    </button>
                  );
                })}
              </div>
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
