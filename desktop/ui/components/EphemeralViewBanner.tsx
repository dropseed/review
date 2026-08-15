import { type ReactNode } from "react";
import { useReviewStore } from "../stores";
import { ephemeralView } from "../stores/selectors/ephemeral";
import { StartReviewButton } from "./StartReviewButton";
import type { ReviewTarget } from "../types";

/**
 * What is on screen while a commit is being peeked at, and the two ways out.
 *
 * A peek looks like a review and isn't one — same diff, same file list, but no
 * approvals, no comments, and nothing written to `~/.review`. That gap is the
 * whole reason this banner exists: the affordances that are missing have to be
 * explained by something, or their absence reads as the app being broken.
 *
 * "Start reviewing" is the deliberate crossing. It hands the commit's SHA to
 * the ordinary review-creation path, which resolves a bare SHA to `sha^..sha`
 * on its own — the same comparison already on screen — so the diff doesn't
 * move underneath the click.
 */
export function EphemeralViewBanner({
  onStartReview,
}: {
  onStartReview?: (path: string, target: ReviewTarget) => Promise<void>;
}): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const viewing = useReviewStore(ephemeralView);
  const setEphemeralView = useReviewStore((s) => s.setEphemeralView);

  if (!viewing) return null;

  return (
    <div className="flex items-center gap-3 border-b border-edge bg-surface-raised/50 px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
        <span className="font-mono text-fg-secondary">{viewing.shortHash}</span>
        <span className="mx-1.5">{viewing.subject}</span>
        <span className="text-fg-faint">
          — viewing only, nothing is recorded
          {/* Said out loud because the diff looks complete and isn't: the
              other parents' changes are simply not here. */}
          {viewing.isMerge && "; merge shown against its first parent"}
        </span>
      </span>

      <StartReviewButton
        label="Start reviewing this range"
        target={
          repoPath ? { path: repoPath, target: { ref: viewing.hash } } : null
        }
        onStartReview={onStartReview}
      />

      <button
        type="button"
        onClick={() => setEphemeralView(null)}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-fg-secondary
                   hover:bg-fg/[0.08] hover:text-fg"
      >
        Back to the review
      </button>
    </div>
  );
}
