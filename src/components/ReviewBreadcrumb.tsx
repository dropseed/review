import type { Comparison } from "../types";
import { useReviewStore } from "../stores";
import { SimpleTooltip } from "./ui/tooltip";

interface ReviewBreadcrumbProps {
  repoName: string;
  comparison: Comparison;
  topLevelView: "overview" | "browse";
  onNavigateToOverview: () => void;
}

function SidebarToggle() {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  return (
    <SimpleTooltip
      content={collapsed ? "Show sidebar (\u2318B)" : "Hide sidebar (\u2318B)"}
    >
      <button
        onClick={toggleTabRail}
        className="flex items-center justify-center w-7 h-7 rounded-md
                   hover:bg-stone-800/60 transition-colors duration-100
                   focus:outline-hidden focus:ring-2 focus:ring-stone-500/50
                   text-stone-500 hover:text-stone-300"
        aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
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

function getCompareLabel(comparison: Comparison): string {
  if (comparison.workingTree) return "Working Tree";
  if (comparison.stagedOnly) return "Staged";
  return comparison.new;
}

function getOverviewLabel(comparison: Comparison): string {
  if (comparison.githubPr) return `PR #${comparison.githubPr.number}`;
  return `${comparison.old}..${getCompareLabel(comparison)}`;
}

export function ReviewBreadcrumb({
  repoName,
  comparison,
  topLevelView,
  onNavigateToOverview,
}: ReviewBreadcrumbProps) {
  const isBrowsing = topLevelView === "browse";
  const isPr = !!comparison.githubPr;

  return (
    <div className="flex items-center gap-1.5">
      <SidebarToggle />

      <span className="text-xs font-medium text-stone-300">{repoName}</span>

      <span className="text-stone-600 text-xs">/</span>

      {isBrowsing ? (
        <button
          onClick={onNavigateToOverview}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5
                     text-xs text-stone-400 hover:text-stone-200
                     hover:bg-stone-800/60 transition-colors duration-100
                     cursor-pointer"
        >
          <svg
            className="w-3 h-3 text-stone-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className={isPr ? "" : "font-mono"}>
            {getOverviewLabel(comparison)}
          </span>
        </button>
      ) : (
        <span className={`text-xs text-stone-500 ${isPr ? "" : "font-mono"}`}>
          {getOverviewLabel(comparison)}
        </span>
      )}
    </div>
  );
}
