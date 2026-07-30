import { type ReactNode } from "react";
import type { ReviewTier } from "../../types";
import { GitTreeIcon } from "../ui/icons";
import { TerminalStatusBadge } from "./TerminalStatusBadge";

/**
 * Tier marker for a sidebar row.
 *
 * Rendered only below `materialized`: a checked-out row already shows the
 * worktree icon and the terminal badge, so a third marker would be noise. The
 * point of this dot is to distinguish "nothing local yet" from "diff is here".
 */
function TierDot({ tier }: { tier: ReviewTier }): ReactNode {
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

interface RowStatusProps {
  repoPath: string;
  /** The row's ref — its identity, and what a re-homed terminal names. */
  reviewRef: string;
  /** The row's own checkout: a linked worktree, the repo root for the main
   *  working-tree row, or null when the row has no checkout at all. */
  checkoutPath?: string | null;
  tier: ReviewTier;
  /** Show the worktree glyph. Suppressed for the main working tree, which is
   *  a checkout but not a *linked* worktree. */
  showWorktreeIcon?: boolean;
}

/**
 * The status cluster shared by every sidebar row.
 *
 * This lives in one place because a row's status doesn't depend on where the
 * row came from. Previously the terminal badge was rendered only by the
 * review-row component, so a branch row — including the repo's own
 * working-tree row — could never show one even while hosting terminals.
 */
export function RowStatus({
  repoPath,
  reviewRef,
  checkoutPath,
  tier,
  showWorktreeIcon = false,
}: RowStatusProps): ReactNode {
  return (
    <>
      <TierDot tier={tier} />
      {showWorktreeIcon && checkoutPath && (
        <span className="text-fg-faint" title="worktree">
          <GitTreeIcon className="h-3.5 w-3.5" />
        </span>
      )}
      <TerminalStatusBadge repoPath={repoPath} reviewRef={reviewRef} />
    </>
  );
}
