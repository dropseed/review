import { useFeedbackPanel } from "../hooks";
import { FeedbackPanel } from "./FilesPanel/FeedbackPanel";

function ChatBubbleIcon() {
  return (
    <svg
      className="h-4 w-4 text-stone-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
      />
    </svg>
  );
}

function FeedbackCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-amber-500/20 px-1.5 text-xxs font-medium tabular-nums text-amber-300">
      {count}
    </span>
  );
}

export function FloatingFeedbackPanel() {
  const {
    notes,
    annotations,
    setReviewNotes,
    deleteAnnotation,
    isExpanded,
    setIsExpanded,
    hasFeedbackToExport,
    goToFile,
    rejectedHunks,
    feedbackCount,
    copied,
    copyFeedbackToClipboard,
  } = useFeedbackPanel();

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="absolute bottom-4 right-4 z-[30] flex items-center gap-2 rounded-full bg-stone-900/95 backdrop-blur-xl border border-stone-700/50 shadow-xl px-3.5 py-2 text-stone-300 hover:bg-stone-800/95 hover:border-stone-600/50 transition-all duration-150"
      >
        <ChatBubbleIcon />
        <span className="text-xs font-medium">Review Notes</span>
        <FeedbackCountBadge count={feedbackCount} />
      </button>
    );
  }

  const copyButtonClass = copied
    ? "btn w-full text-xs transition-all bg-lime-500/15 text-lime-400 border border-lime-500/25"
    : "btn w-full text-xs transition-all bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/20";

  return (
    <div className="absolute bottom-4 right-4 z-[30] w-80 max-h-[28rem] flex flex-col rounded-xl bg-stone-900/95 backdrop-blur-xl border border-stone-700/50 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-800/80">
        <ChatBubbleIcon />
        <span className="text-xs font-medium text-stone-300 flex-1">
          Review Notes
        </span>
        <FeedbackCountBadge count={feedbackCount} />
        <button
          onClick={() => setIsExpanded(false)}
          className="p-1 text-stone-500 hover:text-stone-300 hover:bg-stone-800 rounded transition-colors"
          aria-label="Collapse review notes panel"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
            />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <FeedbackPanel
          notes={notes}
          onNotesChange={setReviewNotes}
          rejectedHunks={rejectedHunks}
          onGoToRejectedHunk={goToFile}
          annotations={annotations}
          onGoToAnnotation={(a) => goToFile(a.filePath)}
          onDeleteAnnotation={deleteAnnotation}
        />
      </div>

      {/* Copy Feedback button */}
      {hasFeedbackToExport && (
        <div className="border-t border-stone-800/80 p-3">
          <button onClick={copyFeedbackToClipboard} className={copyButtonClass}>
            {copied ? (
              <>
                <svg
                  className="h-3.5 w-3.5 mr-1.5 inline-block"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg
                  className="h-3.5 w-3.5 mr-1.5 inline-block"
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
                Copy as Markdown
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
