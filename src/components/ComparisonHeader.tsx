import type { Comparison } from "../types";

interface ComparisonHeaderProps {
  comparison: Comparison;
  onBack: () => void;
}

export function ComparisonHeader({
  comparison,
  onBack,
}: ComparisonHeaderProps) {
  const compareDisplay = comparison.workingTree
    ? "Working Tree"
    : comparison.stagedOnly
      ? "Staged"
      : comparison.new;

  return (
    <div className="flex items-center gap-2 h-full">
      {/* Comparison display - single row, baseline aligned */}
      {/* Base ref */}
      <div className="relative group">
        <span
          className="inline-flex items-center font-mono text-sm text-stone-300 px-2 py-1 rounded-md
                       bg-stone-800/50 border border-stone-700/30
                       transition-all duration-150
                       group-hover:border-stone-600/50 group-hover:bg-stone-800"
        >
          {comparison.old}
        </span>
        {/* Tooltip */}
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5
                        opacity-0 group-hover:opacity-100 pointer-events-none
                        transition-opacity duration-150 z-50"
        >
          <span
            className="text-[10px] text-stone-500 bg-stone-900 border border-stone-700
                          px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap"
          >
            base
          </span>
        </div>
      </div>

      {/* Dots connector - semantic "range" indicator instead of arrow */}
      <span className="text-stone-600 font-mono text-sm select-none">..</span>

      {/* Compare ref */}
      <div className="relative group">
        <span
          className={`inline-flex items-center font-mono text-sm px-2 py-1 rounded-md border
                        transition-all duration-150
                        group-hover:border-stone-600/50
                        ${
                          comparison.workingTree
                            ? "text-violet-400 bg-violet-500/10 border-violet-500/20 group-hover:bg-violet-500/15"
                            : comparison.stagedOnly
                              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 group-hover:bg-emerald-500/15"
                              : "text-stone-300 bg-stone-800/50 border-stone-700/30 group-hover:bg-stone-800"
                        }`}
        >
          {compareDisplay}
        </span>
        {/* Tooltip */}
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5
                        opacity-0 group-hover:opacity-100 pointer-events-none
                        transition-opacity duration-150 z-50"
        >
          <span
            className="text-[10px] text-stone-500 bg-stone-900 border border-stone-700
                          px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap"
          >
            {comparison.workingTree
              ? "uncommitted changes"
              : comparison.stagedOnly
                ? "staged changes only"
                : "compare"}
          </span>
        </div>
      </div>

      {/* Switch reviews button - horizontal swap icon */}
      <button
        onClick={onBack}
        className="group flex items-center justify-center w-7 h-7 rounded-md
                     text-stone-500 hover:text-stone-200 hover:bg-stone-800/80
                     transition-all duration-150"
        title="Switch reviews"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Two horizontal arrows pointing opposite directions */}
          <path d="M16 3l4 4-4 4" />
          <path d="M20 7H4" />
          <path d="M8 21l-4-4 4-4" />
          <path d="M4 17h16" />
        </svg>
      </button>
    </div>
  );
}
