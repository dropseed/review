import { useState, useEffect } from "react";
import type { GitStatusSummary } from "../../types";
import { getApiClient } from "../../api";

interface GitStatusBarProps {
  repoPath: string;
}

export function GitStatusBar({ repoPath }: GitStatusBarProps) {
  const [status, setStatus] = useState<GitStatusSummary | null>(null);

  useEffect(() => {
    getApiClient()
      .getGitStatus(repoPath)
      .then(setStatus)
      .catch((err) => {
        console.error("Failed to get git status:", err);
      });
  }, [repoPath]);

  if (!status) return null;

  const stagedCount = status.staged.length;
  const modifiedCount = status.unstaged.length;
  const untrackedCount = status.untracked.length;
  const isClean =
    stagedCount === 0 && modifiedCount === 0 && untrackedCount === 0;

  return (
    <div className="mt-2 flex items-center gap-2 font-mono text-xs tabular-nums text-stone-500">
      {/* Branch icon */}
      <svg
        className="h-3.5 w-3.5 text-stone-500 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>

      <span className="text-stone-400">{status.currentBranch}</span>

      <span className="text-stone-700">&middot;</span>

      {isClean ? (
        <span className="flex items-center gap-1 text-stone-500">
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          clean
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {stagedCount > 0 && (
            <span className="text-emerald-500">+{stagedCount} staged</span>
          )}
          {modifiedCount > 0 && (
            <span className="text-amber-500">~{modifiedCount} modified</span>
          )}
          {untrackedCount > 0 && (
            <span className="text-stone-500">?{untrackedCount} untracked</span>
          )}
        </span>
      )}
    </div>
  );
}
