import { useEffect, useCallback, useRef } from "react";
import { useReviewStore } from "../../stores/reviewStore";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffSecs < 60) return rtf.format(-diffSecs, "second");
  if (diffMins < 60) return rtf.format(-diffMins, "minute");
  if (diffHours < 24) return rtf.format(-diffHours, "hour");
  if (diffDays < 7) return rtf.format(-diffDays, "day");
  if (diffDays < 30) return rtf.format(-Math.floor(diffDays / 7), "week");
  return date.toLocaleDateString();
}

interface CommitsPanelProps {
  onSelectCommit: (hash: string) => void;
  selectedCommitHash: string | null;
}

export function CommitsPanel({
  onSelectCommit,
  selectedCommitHash,
}: CommitsPanelProps) {
  const commits = useReviewStore((s) => s.commits);
  const comparison = useReviewStore((s) => s.comparison);
  const historyLoading = useReviewStore((s) => s.historyLoading);
  const repoPath = useReviewStore((s) => s.repoPath);
  const loadCommits = useReviewStore((s) => s.loadCommits);

  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Load commits if empty
  useEffect(() => {
    if (repoPath && commits.length === 0 && !historyLoading) {
      loadCommits(repoPath);
    }
  }, [repoPath, commits.length, historyLoading, loadCommits]);

  // Scroll selected commit into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [selectedCommitHash]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (commits.length === 0) return;

      const currentIndex = selectedCommitHash
        ? commits.findIndex((c) => c.hash === selectedCommitHash)
        : -1;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, commits.length - 1);
        onSelectCommit(commits[nextIndex].hash);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        onSelectCommit(commits[prevIndex].hash);
      }
    },
    [commits, selectedCommitHash, onSelectCommit],
  );

  if (historyLoading && commits.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
          <span className="text-xs text-stone-500">Loading commits...</span>
        </div>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <svg
          className="h-8 w-8 text-stone-700 mb-2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-xs text-stone-500">No commits found</p>
      </div>
    );
  }

  const compareRefColor = comparison.stagedOnly
    ? "text-emerald-400"
    : comparison.workingTree
      ? "text-violet-400"
      : "text-stone-300";

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto scrollbar-thin focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Comparison range header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-800 bg-stone-900 px-3 py-1.5">
        <div className="flex items-center gap-1 text-xs min-w-0">
          <span className="text-stone-400 truncate">{comparison.old}</span>
          <span className="text-stone-600 flex-shrink-0">..</span>
          <span className={`${compareRefColor} truncate`}>
            {comparison.stagedOnly
              ? "Staged"
              : comparison.workingTree
                ? "Working Tree"
                : comparison.new}
          </span>
        </div>
        <span className="text-xxs text-stone-600 tabular-nums flex-shrink-0 ml-2">
          {commits.length} commit{commits.length !== 1 ? "s" : ""}
        </span>
      </div>

      {commits.map((commit) => {
        const isSelected = commit.hash === selectedCommitHash;

        return (
          <button
            key={commit.hash}
            ref={isSelected ? selectedRef : undefined}
            onClick={() => onSelectCommit(commit.hash)}
            className={`w-full text-left px-3 py-2 border-b border-stone-800/40
                       transition-colors duration-75
                       ${
                         isSelected
                           ? "bg-amber-500/10 border-l-2 border-l-amber-500"
                           : "hover:bg-stone-800/40 border-l-2 border-l-transparent"
                       }`}
          >
            <div className="flex items-baseline gap-2 min-w-0">
              <span
                className={`font-mono text-xxs shrink-0 ${
                  isSelected ? "text-amber-400" : "text-stone-500"
                }`}
              >
                {commit.shortHash}
              </span>
              <span
                className={`text-xs truncate ${
                  isSelected ? "text-stone-200" : "text-stone-300"
                }`}
              >
                {commit.message}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xxs text-stone-600 truncate">
                {commit.author}
              </span>
              <span className="text-xxs text-stone-600">
                {formatRelativeTime(commit.date)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
