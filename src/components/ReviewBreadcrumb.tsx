import type { Comparison } from "../types";
import { useReviewStore } from "../stores";
import { SimpleTooltip } from "./ui/tooltip";

interface ReviewBreadcrumbProps {
  repoName: string;
  comparison: Comparison;
  topLevelView: "overview" | "browse";
  selectedFile: string | null;
  onNavigateToOverview: () => void;
}

function SidebarToggle() {
  const collapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  return (
    <SimpleTooltip
      content={collapsed ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
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
          {/* Sidebar layout icon */}
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

export function ReviewBreadcrumb({
  repoName,
  comparison,
  topLevelView,
  selectedFile,
  onNavigateToOverview,
}: ReviewBreadcrumbProps) {
  const isPr = !!comparison.githubPr;
  const isOverview = topLevelView === "overview";

  const fileName = selectedFile ? selectedFile.split("/").pop() : null;

  return (
    <div className="flex items-center gap-2">
      {/* Sidebar toggle */}
      <SidebarToggle />

      {/* Repo name */}
      <button
        onClick={onNavigateToOverview}
        className="cursor-pointer text-xs text-stone-500 hover:text-stone-300 transition-colors duration-100"
      >
        {repoName}
      </button>

      {/* Comparison segment */}
      <span className="text-stone-600 text-xs">/</span>
      {isPr ? (
        <button
          onClick={onNavigateToOverview}
          className="cursor-pointer inline-flex items-center gap-1 font-mono text-xs text-violet-400 px-1.5 py-0.5 rounded-md
                     bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-colors duration-100"
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
          </svg>
          PR #{comparison.githubPr!.number}
        </button>
      ) : (
        <button
          onClick={onNavigateToOverview}
          className="cursor-pointer font-mono text-xs text-stone-400 hover:text-stone-200 transition-colors duration-100"
        >
          {comparison.old}..{getCompareLabel(comparison)}
        </button>
      )}

      {/* File segment — only shown in browse with a selected file */}
      {!isOverview && fileName && (
        <>
          <span className="text-stone-600 text-xs">/</span>
          <span className="text-xs text-stone-300 truncate max-w-[200px]">
            {fileName}
          </span>
        </>
      )}
    </div>
  );
}
