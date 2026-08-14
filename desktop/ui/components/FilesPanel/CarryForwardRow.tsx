import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";

/**
 * Heads-up that reconciliation carried decisions forward after the diff drifted.
 *
 * A row in the column that owns review state, rather than the bordered card it
 * used to be on the overview screen: the fact is about these hunks, and it has
 * to be readable beside them rather than on a screen you leave to start
 * reviewing.
 */
export function CarryForwardRow(): ReactNode {
  const carriedForward = useReviewStore((s) => s.carriedForward);
  const dismiss = useReviewStore((s) => s.dismissCarriedForward);
  if (carriedForward <= 0) return null;

  const noun = carriedForward === 1 ? "decision" : "decisions";
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-edge/60 px-3 py-1.5">
      <p className="min-w-0 flex-1 text-xs leading-snug text-fg-muted">
        {carriedForward} review {noun} carried forward — the diff changed since
        you last reviewed.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded px-1 text-xs text-fg-faint hover:bg-fg/[0.06]
                   hover:text-fg-secondary focus-visible:outline-none
                   focus-visible:ring-1 focus-visible:ring-focus-ring/70"
      >
        Dismiss
      </button>
    </div>
  );
}
