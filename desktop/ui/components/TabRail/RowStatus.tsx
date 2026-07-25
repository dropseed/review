import { type ReactNode } from "react";
import type { ReviewTier } from "../../types";
import { GitTreeIcon } from "../ui/icons";
import { TerminalStatusBadge } from "./TerminalStatusBadge";
import { TierDot } from "./PrPreviewCard";

interface RowStatusProps {
  repoPath: string;
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
      <TerminalStatusBadge repoPath={repoPath} checkoutPath={checkoutPath} />
    </>
  );
}
