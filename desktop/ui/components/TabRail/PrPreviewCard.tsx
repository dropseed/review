import { type ReactNode } from "react";
import type { GitHubPrRef, ReviewTier } from "../../types";

interface PrPreviewCardProps {
  pr: GitHubPrRef;
  tier: ReviewTier;
  /** Files changed / +- lines, when the listing has computed them. */
  stats?: { filesChanged?: number; additions?: number; deletions?: number };
}

/**
 * Hover preview for a PR row.
 *
 * Deliberately built from listing metadata only — no git, no network. Most
 * triage decisions ("not mine", "too big right now", "version bump") are made
 * from the title, author, and size, so answering them shouldn't cost a fetch.
 */
export function PrPreviewCard({
  pr,
  tier,
  stats,
}: PrPreviewCardProps): ReactNode {
  const body = pr.body?.trim();

  return (
    <div className="w-80 space-y-2 p-3">
      <div className="space-y-1">
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-xxs tabular-nums text-fg-faint">
            #{pr.number}
          </span>
          <span className="text-xs font-medium leading-snug text-fg-secondary">
            {pr.title}
          </span>
        </div>
        <div className="font-mono text-xxs text-fg-faint">
          {pr.headRefName} → {pr.baseRefName}
        </div>
      </div>

      {stats && (
        <div className="flex items-center gap-2 text-xxs tabular-nums text-fg-muted">
          {stats.filesChanged != null && (
            <span>
              {stats.filesChanged} file{stats.filesChanged === 1 ? "" : "s"}
            </span>
          )}
          {stats.additions != null && (
            <span className="text-status-approved">+{stats.additions}</span>
          )}
          {stats.deletions != null && (
            <span className="text-status-rejected">−{stats.deletions}</span>
          )}
        </div>
      )}

      {body && (
        <p className="line-clamp-4 whitespace-pre-wrap text-xxs leading-relaxed text-fg-muted">
          {body}
        </p>
      )}

      <div className="border-t border-edge/40 pt-2 text-xxs text-fg-faint">
        {tier === "listed"
          ? "Opening fetches the diff."
          : tier === "fetched"
            ? "Diff is local. Terminals need a checkout."
            : "Checked out — terminals and LSP available."}
      </div>
    </div>
  );
}

/**
 * Tier dot for a sidebar row.
 *
 * Rendered only below `materialized`: a checked-out row already shows the
 * worktree icon and the terminal badge, so a third marker would be noise. The
 * point of this dot is to distinguish "nothing local yet" from "diff is here".
 */
export function TierDot({ tier }: { tier: ReviewTier }): ReactNode {
  if (tier === "materialized") return null;
  const listed = tier === "listed";
  return (
    <span
      className={`inline-block h-1 w-1 shrink-0 rounded-full ${
        listed ? "bg-fg/25" : "bg-fg/50"
      }`}
      title={listed ? "Not fetched yet" : "Diff available locally"}
      aria-hidden="true"
    />
  );
}
