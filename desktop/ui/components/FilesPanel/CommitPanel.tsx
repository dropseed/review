import { AnsiUp } from "ansi_up";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useListContinuation } from "../../hooks";
import { useReviewStore } from "../../stores";
import { CollapsibleSection } from "../ui/collapsible-section";

const MAX_OUTPUT_LINES = 8;
const IS_MAC = navigator.platform?.includes("Mac");
const MOD_KEY_SYMBOL = IS_MAC ? "\u2318" : "Ctrl";

const COMMIT_ICON = (
  <svg
    className="h-3.5 w-3.5 text-fg-muted"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <line x1="3" y1="12" x2="9" y2="12" />
    <line x1="15" y1="12" x2="21" y2="12" />
  </svg>
);

const SPARKLE_ICON = (
  <svg
    className="h-3 w-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  </svg>
);

const TRASH_ICON = (
  <svg
    className="h-3 w-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

const DISMISS_ICON = (
  <svg
    className="h-3 w-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

function SpinnerIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
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
  );
}

export function CommitPanel(): ReactNode {
  const commitMessage = useReviewStore((s) => s.commitMessage);
  const setCommitMessage = useReviewStore((s) => s.setCommitMessage);
  const commitInProgress = useReviewStore((s) => s.commitInProgress);
  const commitOutput = useReviewStore((s) => s.commitOutput);
  const commitResult = useReviewStore((s) => s.commitResult);
  const commitStaged = useReviewStore((s) => s.commitStaged);
  const clearCommitResult = useReviewStore((s) => s.clearCommitResult);
  const staged = useReviewStore((s) => s.gitStatus?.staged);
  const commitMessageGenerating = useReviewStore(
    (s) => s.commitMessageGenerating,
  );
  const generateCommitMessage = useReviewStore((s) => s.generateCommitMessage);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const ansi = useMemo(() => new AnsiUp(), []);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(true);

  const hasStagedFiles = staged && staged.length > 0;

  const canCommit =
    !commitInProgress &&
    !commitMessageGenerating &&
    commitMessage.trim().length > 0 &&
    hasStagedFiles;

  const visibleOutput =
    outputExpanded || commitOutput.length <= MAX_OUTPUT_LINES
      ? commitOutput
      : commitOutput.slice(-MAX_OUTPUT_LINES);
  const hiddenCount = commitOutput.length - visibleOutput.length;

  const handleListKeyDown = useListContinuation(textareaRef, setCommitMessage);

  // Cmd+Enter to commit, Enter to continue lists
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) {
        e.preventDefault();
        commitStaged();
        return;
      }
      handleListKeyDown(e);
    },
    [canCommit, commitStaged, handleListKeyDown],
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

  // Auto-resize textarea when commit message changes from streaming
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`;
    }
  }, [commitMessage]);

  if (!hasStagedFiles && !commitResult && !commitInProgress) return null;

  return (
    <CollapsibleSection
      title="Commit"
      icon={COMMIT_ICON}
      isOpen={sectionOpen}
      onToggle={() => setSectionOpen(!sectionOpen)}
    >
      <div className="px-2 py-1.5 flex flex-col gap-1.5">
        <textarea
          ref={textareaRef}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          rows={1}
          disabled={commitInProgress || commitMessageGenerating}
          className="w-full resize-none rounded border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-muted/50 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          style={{ minHeight: "32px", maxHeight: "144px" }}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={generateCommitMessage}
              disabled={
                !hasStagedFiles || commitInProgress || commitMessageGenerating
              }
              title="Generate commit message with AI"
              className="h-5 px-1.5 rounded text-fg-muted text-[10px] hover:text-fg hover:bg-surface-hover disabled:opacity-30 flex items-center gap-1"
            >
              {commitMessageGenerating ? (
                <SpinnerIcon className="animate-spin h-3 w-3" />
              ) : (
                SPARKLE_ICON
              )}
              Generate
            </button>
            {commitMessage && !commitInProgress && !commitMessageGenerating && (
              <button
                onClick={() => setCommitMessage("")}
                title="Clear message"
                className="h-5 w-5 rounded text-fg-muted hover:text-fg hover:bg-surface-hover flex items-center justify-center"
              >
                {TRASH_ICON}
              </button>
            )}
          </div>
          <button
            onClick={commitStaged}
            disabled={!canCommit}
            title={`Commit (${MOD_KEY_SYMBOL}+Enter)`}
            className="h-5 px-1.5 rounded bg-accent text-accent-fg text-[10px] font-medium disabled:opacity-30 hover:bg-accent/90 flex items-center gap-1"
          >
            {commitInProgress ? (
              <SpinnerIcon className="animate-spin h-3 w-3" />
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
                {DISMISS_ICON}
              </button>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
