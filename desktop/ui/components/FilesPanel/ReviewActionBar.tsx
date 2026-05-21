import { type ReactNode } from "react";
import { useFeedbackPanel } from "../../hooks";

const COPY_ICON = (
  <svg
    className="h-3.5 w-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
    />
  </svg>
);

const CHECK_ICON = (
  <svg
    className="h-3.5 w-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

/**
 * The review's primary action, pinned to the bottom of the sidebar. Today it
 * copies a Markdown representation of the whole review; for a GitHub PR this
 * is where "Submit review" will live.
 */
export function ReviewActionBar(): ReactNode {
  const { hasReviewContent, progress, copied, copyReviewToClipboard } =
    useFeedbackPanel();

  const statusLine = !hasReviewContent
    ? "Approve, reject, or comment to start your review"
    : progress.totalHunks === 0
      ? "No diff hunks to review"
      : progress.rejectedHunks > 0
        ? `${progress.reviewedHunks}/${progress.totalHunks} reviewed · ${progress.rejectedHunks} changes requested`
        : `${progress.reviewedHunks}/${progress.totalHunks} hunks reviewed`;

  return (
    <div className="shrink-0 border-t border-edge/40 bg-surface-panel px-3 py-2.5">
      <button
        type="button"
        disabled={!hasReviewContent}
        onClick={copyReviewToClipboard}
        title="Copy a Markdown summary of the whole review"
        className={`flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors ${
          !hasReviewContent
            ? "cursor-not-allowed bg-surface-raised/40 text-fg-faint"
            : copied
              ? "bg-status-approved/20 text-status-approved"
              : "bg-surface-active text-fg hover:bg-surface-active/80 active:scale-[0.98]"
        }`}
      >
        {copied ? CHECK_ICON : COPY_ICON}
        {copied ? "Copied" : "Copy review"}
      </button>
      <p className="mt-1.5 text-center text-[10px] text-fg-muted">
        {statusLine}
      </p>
    </div>
  );
}
