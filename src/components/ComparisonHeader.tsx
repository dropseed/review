import type { Comparison } from "../types";
import { SimpleTooltip } from "./ui/tooltip";

interface DiffStats {
  fileCount: number;
  additions: number;
  deletions: number;
}

interface ComparisonHeaderProps {
  comparison: Comparison;
  diffStats?: DiffStats;
  onStatsClick?: () => void;
  isOverviewActive?: boolean;
}

export function ComparisonHeader({
  comparison,
  diffStats,
  onStatsClick,
  isOverviewActive,
}: ComparisonHeaderProps) {
  const isPr = !!comparison.githubPr;
  const compareDisplay = comparison.workingTree
    ? "Working Tree"
    : comparison.stagedOnly
      ? "Staged"
      : comparison.new;

  return (
    <div className="flex items-center gap-2 h-full">
      {isPr ? (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 font-mono text-sm text-violet-400 px-2 py-1 rounded-md
                       bg-violet-500/10 border border-violet-500/20"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
            </svg>
            PR #{comparison.githubPr!.number}
          </span>
          <span className="text-sm text-stone-300 truncate max-w-[200px]">
            {comparison.githubPr!.title}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center font-mono text-sm text-stone-300 px-2 py-1 rounded-md
                       bg-stone-800/50 border border-stone-700/30"
          >
            {comparison.old}
          </span>
          <span className="text-stone-600 font-mono text-sm select-none">
            ..
          </span>
          <span
            className={`inline-flex items-center font-mono text-sm px-2 py-1 rounded-md border
                        ${
                          comparison.workingTree
                            ? "text-violet-400 bg-violet-500/10 border-violet-500/20"
                            : comparison.stagedOnly
                              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                              : "text-stone-300 bg-stone-800/50 border-stone-700/30"
                        }`}
          >
            {compareDisplay}
          </span>
        </div>
      )}

      {diffStats && diffStats.fileCount > 0 && (
        <SimpleTooltip content="Overview (Esc)">
          <button
            onClick={onStatsClick}
            className={`flex items-center gap-2 font-mono text-xs tabular-nums px-2 py-1 rounded-md transition-colors ${
              isOverviewActive
                ? "bg-stone-800 text-stone-300"
                : "text-stone-500 hover:bg-stone-800/60 hover:text-stone-400"
            }`}
          >
            <span>
              {diffStats.fileCount}{" "}
              {diffStats.fileCount === 1 ? "file" : "files"}
            </span>
            <span className="text-green-500">+{diffStats.additions}</span>
            <span className="text-red-500">-{diffStats.deletions}</span>
          </button>
        </SimpleTooltip>
      )}
    </div>
  );
}
