import { type ReactNode, useCallback } from "react";
import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ReviewTarget } from "../types";

/**
 * The crossing from looking at a diff to reviewing it.
 *
 * Both banners that say "you can't act on this" offer the same way out, so the
 * button is one component rather than two copies that had already drifted in
 * their label. The caller supplies the target because that is the whole of what
 * differs: a read-only preview promotes the branch it is previewing, a commit
 * peek promotes the commit.
 */
export function StartReviewButton({
  label,
  target,
  onStartReview,
}: {
  label: string;
  /** The review to create, or null while there isn't one to name yet. */
  target: { path: string; target: ReviewTarget } | null;
  onStartReview?: (path: string, target: ReviewTarget) => Promise<void>;
}): ReactNode {
  const startReviewAction = useCallback(async () => {
    if (!target || !onStartReview) return;
    await onStartReview(target.path, target.target);
  }, [target, onStartReview]);
  const [handleClick, starting] = useAsyncAction(
    startReviewAction,
    "start review",
  );

  if (!onStartReview) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={starting}
      className="shrink-0 rounded-lg bg-sage-500 px-3 py-1.5 text-xs font-semibold text-surface
                 transition-colors duration-150 hover:bg-sage-400
                 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {starting ? "Starting..." : label}
    </button>
  );
}
