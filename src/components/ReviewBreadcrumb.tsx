import type { Comparison, GitHubPrRef } from "../types";
import { useReviewStore } from "../stores";
import { SimpleTooltip } from "./ui/tooltip";

interface ReviewBreadcrumbProps {
  repoName: string;
  comparison: Comparison;
}

interface ReviewTitleProps {
  title?: string | null;
}

function SidebarToggle() {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  if (!collapsed) return null;

  return (
    <SimpleTooltip content="Show sidebar (\u2318B)">
      <button
        type="button"
        onClick={toggleTabRail}
        className="flex items-center justify-center w-7 h-7 rounded-md
                   hover:bg-stone-800/60 transition-colors duration-100
                   focus:outline-hidden focus:ring-2 focus:ring-stone-500/50
                   text-stone-500 hover:text-stone-300"
        aria-label="Show sidebar"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
    </SimpleTooltip>
  );
}

function getOverviewLabel(
  comparison: Comparison,
  githubPr?: GitHubPrRef,
): string {
  if (githubPr) return `PR #${githubPr.number}`;
  return `${comparison.base}..${comparison.head}`;
}

export function ReviewBreadcrumb({
  repoName,
  comparison,
}: ReviewBreadcrumbProps) {
  const githubPr = useReviewStore((s) => s.reviewState?.githubPr);
  const isPr = !!githubPr;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <SidebarToggle />
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-xs font-medium text-stone-300">
          {repoName}
        </span>
        <span className="shrink-0 text-stone-600 text-xs">/</span>
        <span
          className={`shrink-0 text-xs text-stone-400 ${isPr ? "font-medium" : "font-mono"}`}
        >
          {getOverviewLabel(comparison, githubPr)}
        </span>
      </div>
    </div>
  );
}

export function ReviewTitle({ title }: ReviewTitleProps) {
  const githubPrTitle = useReviewStore((s) => s.reviewState?.githubPr?.title);
  const displayTitle = githubPrTitle || title;
  if (!displayTitle) return null;

  return (
    <div className="truncate text-sm font-medium text-stone-200 leading-tight px-4 mt-1">
      {displayTitle}
    </div>
  );
}
