import { useState, useRef, useEffect, useCallback } from "react";
import { useFeedbackPanel } from "../../hooks";
import { useReviewStore } from "../../stores";
import { FeedbackPanelContent } from "./FeedbackPanelContent";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";

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

function ResetIcon() {
  return (
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
        d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
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
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"
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

export function FeedbackPanel() {
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
    clearFeedback,
  } = useFeedbackPanel();

  const resetReview = useReviewStore((s) => s.resetReview);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clearButtonRef = useRef<HTMLButtonElement>(null);

  // Reset confirmation state after timeout
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
    };
  }, []);

  const handleClearClick = useCallback(() => {
    if (confirmingClear) {
      clearFeedback();
      setConfirmingClear(false);
      if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
    } else {
      setConfirmingClear(true);
      clearTimeoutRef.current = setTimeout(
        () => setConfirmingClear(false),
        3000,
      );
    }
  }, [confirmingClear, clearFeedback]);

  const handleClearBlur = useCallback(() => {
    // Small delay so the click handler fires first
    setTimeout(() => setConfirmingClear(false), 150);
  }, []);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="absolute bottom-4 right-4 z-[30] flex items-center gap-2 rounded-full bg-stone-900/95 backdrop-blur-xl border border-stone-700/50 shadow-xl px-3.5 py-2 text-stone-300 hover:bg-stone-800/95 hover:border-stone-600/50 transition-colors duration-150"
      >
        <ChatBubbleIcon />
        <span className="text-xs font-medium">Review Notes</span>
        <FeedbackCountBadge count={feedbackCount} />
      </button>
    );
  }

  const copyButtonClass = copied
    ? "btn w-full text-xs transition-colors bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
    : "btn w-full text-xs transition-colors bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/20";

  return (
    <div className="absolute bottom-4 right-4 z-[30] w-80 max-h-[28rem] flex flex-col rounded-xl bg-stone-900/95 backdrop-blur-xl border border-stone-700/50 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-800/80">
        <ChatBubbleIcon />
        <span className="text-xs font-medium text-stone-300 flex-1">
          Review Notes
        </span>
        <FeedbackCountBadge count={feedbackCount} />
        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) setConfirmingReset(false);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button className="p-1 text-stone-500 hover:text-stone-300 hover:bg-stone-800 rounded transition-colors">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {confirmingReset ? (
              <DropdownMenuItem
                onClick={async () => {
                  await resetReview();
                  setConfirmingReset(false);
                }}
                className="text-red-400 focus:text-red-400"
              >
                <WarningIcon />
                Confirm reset
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                onClick={() => setConfirmingReset(true)}
                className="text-red-400 focus:text-red-400"
              >
                <ResetIcon />
                Reset review
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
        <FeedbackPanelContent
          notes={notes}
          onNotesChange={setReviewNotes}
          rejectedHunks={rejectedHunks}
          onGoToRejectedHunk={goToFile}
          annotations={annotations}
          onGoToAnnotation={(a) => goToFile(a.filePath)}
          onDeleteAnnotation={deleteAnnotation}
        />
      </div>

      {/* Copy Feedback + Clear button */}
      {hasFeedbackToExport && (
        <div className="border-t border-stone-800/80 p-3 flex gap-2">
          <button
            onClick={copyFeedbackToClipboard}
            className={copyButtonClass + " flex-1"}
          >
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
          <button
            ref={clearButtonRef}
            onClick={handleClearClick}
            onBlur={handleClearBlur}
            className={
              confirmingClear
                ? "btn text-xs px-2.5 transition-colors bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25"
                : "btn text-xs px-2.5 transition-colors bg-stone-800 text-stone-400 border border-stone-700/50 hover:text-stone-300 hover:bg-stone-700/50"
            }
            title={
              confirmingClear
                ? "Click again to clear"
                : "Clear notes and annotations"
            }
          >
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
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
