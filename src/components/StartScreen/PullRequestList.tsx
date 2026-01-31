import { useState, useEffect, useCallback, memo } from "react";
import type { Comparison, PullRequest } from "../../types";
import { makePrComparison } from "../../types";
import { getApiClient } from "../../api";

// Intl.RelativeTimeFormat for proper i18n
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return rtf.format(-diffMins, "minute");
  if (diffHours < 24) return rtf.format(-diffHours, "hour");
  if (diffDays < 7) return rtf.format(-diffDays, "day");
  if (diffDays < 30) return rtf.format(-Math.floor(diffDays / 7), "week");
  return date.toLocaleDateString();
}

// --- PR Card ---

interface PrCardProps {
  pr: PullRequest;
  index: number;
  isExisting: boolean;
  prefersReducedMotion: boolean;
  onSelect: () => void;
}

const PrCard = memo(function PrCard({
  pr,
  index,
  isExisting,
  prefersReducedMotion,
  onSelect,
}: PrCardProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    [onSelect],
  );

  return (
    <article
      className={`group relative rounded-xl border
                 backdrop-blur-sm shadow-lg shadow-black/20
                 transition-all duration-200
                 ${
                   isExisting
                     ? "border-stone-800/40 bg-stone-900/30 opacity-60"
                     : `border-stone-800/80 bg-gradient-to-br from-stone-900/80 to-stone-900/40
                        hover:border-violet-500/25 hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl hover:shadow-violet-900/10
                        hover:-translate-y-0.5`
                 }
                 ${prefersReducedMotion ? "" : "animate-fade-in"}`}
      style={
        prefersReducedMotion ? undefined : { animationDelay: `${index * 50}ms` }
      }
    >
      <button
        onClick={isExisting ? undefined : onSelect}
        onKeyDown={isExisting ? undefined : handleKeyDown}
        disabled={isExisting}
        className={`w-full px-5 py-4 text-left rounded-xl
                   focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:ring-inset
                   ${isExisting ? "cursor-default" : ""}`}
        aria-label={
          isExisting
            ? `PR #${pr.number}: ${pr.title} — already reviewing`
            : `Review PR #${pr.number}: ${pr.title}`
        }
      >
        {/* Main row */}
        <div className="flex items-center gap-3">
          {/* PR number badge */}
          <span
            className={`inline-flex items-center gap-1 shrink-0 font-mono text-xs px-2 py-0.5 rounded-md border
                        ${
                          isExisting
                            ? "text-stone-500 bg-stone-800/30 border-stone-700/20"
                            : "text-violet-400 bg-violet-500/10 border-violet-500/20"
                        }`}
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
            </svg>
            #{pr.number}
          </span>

          {/* Title */}
          <span
            className={`text-sm truncate ${
              isExisting
                ? "text-stone-500"
                : "text-stone-200 font-medium group-hover:text-stone-100"
            }`}
          >
            {pr.title}
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Already reviewing indicator */}
          {isExisting && (
            <span className="text-[10px] text-stone-600 whitespace-nowrap shrink-0">
              already reviewing
            </span>
          )}
        </div>

        {/* Metadata row */}
        <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
          {/* Author */}
          <span className="flex items-center gap-1">
            <svg
              className="w-3 h-3 text-stone-600"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.004 6.004 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
            </svg>
            {pr.author.login}
          </span>

          {/* Branch refs */}
          <span className="flex items-center gap-1 font-mono text-stone-600 truncate">
            <span className="truncate">{pr.baseRefName}</span>
            <svg
              className="w-3 h-3 shrink-0 text-stone-700"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                clipRule="evenodd"
              />
            </svg>
            <span className="truncate">{pr.headRefName}</span>
          </span>

          <div className="flex-1" />

          {/* Time */}
          <time
            dateTime={pr.updatedAt}
            className="text-stone-600 whitespace-nowrap shrink-0"
          >
            {formatRelativeTime(pr.updatedAt)}
          </time>
        </div>
      </button>
    </article>
  );
});

// --- Main component ---

interface PullRequestListProps {
  repoPath: string;
  onSelectReview: (comparison: Comparison) => void;
  existingComparisonKeys: string[];
  prefersReducedMotion: boolean;
}

export function PullRequestList({
  repoPath,
  onSelectReview,
  existingComparisonKeys,
  prefersReducedMotion,
}: PullRequestListProps) {
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const client = getApiClient();

    client
      .checkGitHubAvailable(repoPath)
      .then((isAvailable) => {
        if (cancelled) return;
        setAvailable(isAvailable);
        if (!isAvailable) {
          setLoading(false);
          return;
        }
        return client.listPullRequests(repoPath);
      })
      .then((prs) => {
        if (cancelled || !prs) return;
        setPullRequests(prs);
      })
      .catch((err) => {
        console.error("Failed to load pull requests:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // Don't render anything if gh is not available or no PRs
  if (!available || (!loading && pullRequests.length === 0)) {
    return null;
  }

  const existingKeys = new Set(existingComparisonKeys);

  return (
    <section aria-labelledby="pull-requests-heading" className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <h2
          id="pull-requests-heading"
          className="text-sm font-semibold text-stone-300 flex items-center gap-2"
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-violet-400"
            aria-hidden="true"
          />
          Pull Requests
        </h2>
        {loading && (
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-stone-700 border-t-violet-500"
            role="status"
            aria-label="Loading pull requests..."
          />
        )}
      </div>

      <div className="space-y-2" role="list">
        {pullRequests.map((pr, index) => {
          const prKey = `pr-${pr.number}`;
          const isExisting = existingKeys.has(prKey);
          return (
            <PrCard
              key={pr.number}
              pr={pr}
              index={index}
              isExisting={isExisting}
              prefersReducedMotion={prefersReducedMotion}
              onSelect={() => onSelectReview(makePrComparison(pr))}
            />
          );
        })}
      </div>
    </section>
  );
}
