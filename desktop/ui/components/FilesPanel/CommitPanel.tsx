import { AnsiUp } from "ansi_up";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../../stores";

const MAX_OUTPUT_LINES = 8;
const IS_MAC = navigator.platform?.includes("Mac");
const MOD_KEY_SYMBOL = IS_MAC ? "\u2318" : "Ctrl";

export function CommitPanel(): ReactNode {
  const commitMessage = useReviewStore((s) => s.commitMessage);
  const setCommitMessage = useReviewStore((s) => s.setCommitMessage);
  const commitInProgress = useReviewStore((s) => s.commitInProgress);
  const commitOutput = useReviewStore((s) => s.commitOutput);
  const commitResult = useReviewStore((s) => s.commitResult);
  const commitStaged = useReviewStore((s) => s.commitStaged);
  const clearCommitResult = useReviewStore((s) => s.clearCommitResult);
  const staged = useReviewStore((s) => s.gitStatus?.staged);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const ansi = useMemo(() => new AnsiUp(), []);
  const [outputExpanded, setOutputExpanded] = useState(false);

  const hasStagedFiles = staged && staged.length > 0;
  if (!hasStagedFiles && !commitResult && !commitInProgress) return null;

  const canCommit =
    !commitInProgress && commitMessage.trim().length > 0 && hasStagedFiles;

  const visibleOutput =
    outputExpanded || commitOutput.length <= MAX_OUTPUT_LINES
      ? commitOutput
      : commitOutput.slice(-MAX_OUTPUT_LINES);
  const hiddenCount = commitOutput.length - visibleOutput.length;

  // Auto-resize textarea
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCommitMessage(e.target.value);
      const ta = e.target;
      ta.style.height = "auto";
      // Clamp between 1 line (~24px) and 6 lines (~144px)
      ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`;
    },
    [setCommitMessage],
  );

  // Cmd+Enter to commit
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
        e.preventDefault();
        commitStaged();
      }
    },
    [canCommit, commitStaged],
  );

  // Auto-scroll output area
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [commitOutput]);

  // Reset expanded state when a new commit starts
  useEffect(() => {
    if (commitInProgress) setOutputExpanded(false);
  }, [commitInProgress]);

  // Auto-clear success banner after 4 seconds
  useEffect(() => {
    if (!commitResult?.success) return;
    const timer = setTimeout(clearCommitResult, 4000);
    return () => clearTimeout(timer);
  }, [commitResult, clearCommitResult]);

  return (
    <div className="border-b border-border px-2 py-2 flex flex-col gap-1.5">
      {/* Textarea with commit button inside */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={commitMessage}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          rows={1}
          disabled={commitInProgress}
          className="w-full resize-none rounded border border-border bg-surface px-2 py-1.5 pb-7 text-xs text-fg placeholder:text-fg-muted/50 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          style={{ minHeight: "52px", maxHeight: "144px" }}
        />
        <button
          onClick={() => commitStaged()}
          disabled={!canCommit}
          title={`Commit (${MOD_KEY_SYMBOL}+Enter)`}
          className="absolute right-1.5 bottom-1.5 h-5 px-1.5 rounded bg-accent text-accent-fg text-[10px] font-medium disabled:opacity-30 hover:bg-accent/90 flex items-center gap-1"
        >
          {commitInProgress ? (
            <svg
              className="animate-spin h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <>
              Commit{" "}
              <span className="opacity-50">
                {MOD_KEY_SYMBOL}
                {"\u23CE"}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Streaming output area with ANSI color support */}
      {commitOutput.length > 0 && (
        <div className="rounded bg-black/80 font-mono text-[10px] leading-tight text-neutral-300 overflow-hidden">
          {hiddenCount > 0 && (
            <button
              onClick={() => setOutputExpanded(true)}
              className="w-full px-2 py-0.5 text-neutral-500 hover:text-neutral-300 text-center"
            >
              Show {hiddenCount} more {hiddenCount === 1 ? "line" : "lines"}
            </button>
          )}
          <div
            ref={outputRef}
            className="max-h-24 overflow-y-auto px-2 py-1 scrollbar-thin"
          >
            {visibleOutput.map((line) => (
              <div
                key={line.seq}
                dangerouslySetInnerHTML={{
                  __html: ansi.ansi_to_html(line.text),
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Result banner */}
      {commitResult && (
        <div
          className={`rounded px-2 py-1 text-xs flex items-center justify-between ${
            commitResult.success
              ? "bg-status-added/15 text-status-added"
              : "bg-status-deleted/15 text-status-deleted"
          }`}
        >
          <span>
            {commitResult.success
              ? `Committed ${commitResult.commitHash ?? ""}`
              : commitResult.summary}
          </span>
          {!commitResult.success && (
            <button
              onClick={clearCommitResult}
              className="ml-2 text-fg-muted hover:text-fg"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
