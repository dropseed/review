import {
  type ReactNode,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useFeedbackPanel, useListContinuation } from "../../hooks";
import { CollapsibleSection } from "../ui/collapsible-section";
import { DropdownMenuItem } from "../ui/dropdown-menu";

const NOTES_ICON = (
  <svg
    className="h-3.5 w-3.5 text-fg-muted"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

/** Split a file path into its directory prefix and filename. */
function splitFilePath(filePath: string): {
  dirPath: string;
  fileName: string;
} {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash < 0) return { dirPath: "", fileName: filePath };
  return {
    dirPath: filePath.substring(0, lastSlash + 1),
    fileName: filePath.substring(lastSlash + 1),
  };
}

/** Renders a file path with the directory dimmed and the filename highlighted. */
function FilePathLabel({ filePath }: { filePath: string }): ReactNode {
  const { dirPath, fileName } = splitFilePath(filePath);
  return (
    <span className="flex-1 min-w-0 truncate text-[11px]">
      {dirPath && <span className="text-fg-muted/40">{dirPath}</span>}
      <span className="text-fg-secondary group-hover/item:text-fg">
        {fileName}
      </span>
    </span>
  );
}

export function ReviewNotesPanel(): ReactNode {
  const {
    notes,
    standaloneAnnotations,
    setReviewNotes,
    deleteAnnotation,
    hasFeedbackToExport,
    goToFile,
    rejectedHunks,
    feedbackCount,
    copied,
    copyFeedbackToClipboard,
    clearFeedback,
  } = useFeedbackPanel();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
    };
  }, []);

  const handleListKeyDown = useListContinuation(textareaRef, setReviewNotes);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }, [notes]);

  const confirmClear = useCallback(() => {
    clearFeedback();
    setConfirmingClear(false);
    if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
  }, [clearFeedback]);

  const startClearConfirmation = useCallback(() => {
    setConfirmingClear(true);
    clearTimeoutRef.current = setTimeout(() => setConfirmingClear(false), 3000);
  }, []);

  const menuContent = (
    <>
      <DropdownMenuItem
        onClick={copyFeedbackToClipboard}
        disabled={!hasFeedbackToExport}
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
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        {copied ? "Copied!" : "Copy as Markdown"}
      </DropdownMenuItem>
      {confirmingClear ? (
        <DropdownMenuItem
          onClick={confirmClear}
          className="text-status-rejected focus:text-status-rejected"
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
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"
            />
          </svg>
          Confirm clear
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          disabled={!hasFeedbackToExport}
          onSelect={(e) => {
            if (hasFeedbackToExport) e.preventDefault();
          }}
          onClick={() => {
            if (hasFeedbackToExport) startClearConfirmation();
          }}
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
          Clear feedback
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <CollapsibleSection
      title="Notes"
      icon={NOTES_ICON}
      badge={feedbackCount || undefined}
      badgeColor="bg-status-modified/20 text-status-modified"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      menuContent={menuContent}
    >
      <div className="px-2 pb-2 flex flex-col gap-1.5">
        <textarea
          ref={textareaRef}
          value={notes}
          onChange={(e) => setReviewNotes(e.target.value)}
          onKeyDown={handleListKeyDown}
          placeholder="Review notes..."
          rows={1}
          className="w-full resize-none rounded border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
          style={{ minHeight: "32px", maxHeight: "120px" }}
        />

        {hasFeedbackToExport && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                if (confirmingReset) {
                  clearFeedback();
                  setConfirmingReset(false);
                } else {
                  setConfirmingReset(true);
                  setTimeout(() => setConfirmingReset(false), 3000);
                }
              }}
              title={
                confirmingReset ? "Click again to confirm" : "Clear feedback"
              }
              className={`h-5 px-1.5 rounded text-[10px] flex items-center gap-1 ${
                confirmingReset
                  ? "text-status-rejected"
                  : "text-fg-muted hover:text-fg hover:bg-surface-hover"
              }`}
            >
              <svg
                className="h-3 w-3"
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
              {confirmingReset ? "Confirm" : "Clear"}
            </button>
            <button
              onClick={copyFeedbackToClipboard}
              title="Copy feedback as Markdown"
              className={`h-5 px-1.5 rounded text-[10px] font-medium flex items-center gap-1 ${
                copied
                  ? "text-status-approved"
                  : "text-fg-muted hover:text-fg hover:bg-surface-hover"
              }`}
            >
              {copied ? (
                <>
                  <svg
                    className="h-3 w-3"
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
                  Copied
                </>
              ) : (
                <>
                  <svg
                    className="h-3 w-3"
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
                  Copy
                </>
              )}
            </button>
          </div>
        )}

        {rejectedHunks.length > 0 && (
          <div className="flex flex-col">
            <div className="px-1 pb-0.5 flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-status-rejected/80">
                Changes requested
              </span>
              <span className="text-[9px] tabular-nums text-fg-muted/40">
                {rejectedHunks.length}
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto scrollbar-thin flex flex-col gap-px">
              {rejectedHunks.map((item) => (
                <div key={item.hunkId} className="flex flex-col">
                  <button
                    onClick={() => goToFile(item.filePath)}
                    className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-r border-l-2 border-l-status-rejected/30 hover:border-l-status-rejected/70 hover:bg-surface-hover/60 transition-colors text-left group/item"
                  >
                    <FilePathLabel filePath={item.filePath} />
                    <span className="shrink-0 text-[9px] tabular-nums text-fg-muted/40 bg-surface-raised/60 rounded px-1 py-px">
                      {item.lineRange}
                    </span>
                  </button>
                  {item.annotations.map((a) => (
                    <div
                      key={a.id}
                      className="group/nested relative ml-2.5 rounded-r border-l-2 border-l-status-modified/30 hover:border-l-status-modified/70 hover:bg-surface-hover/60 transition-colors"
                    >
                      <button
                        onClick={() => goToFile(a.filePath)}
                        className="w-full text-left pl-1.5 pr-5 py-0.5"
                      >
                        <p className="text-[10px] leading-snug text-fg-muted/70 line-clamp-2">
                          {a.content}
                        </p>
                      </button>
                      <button
                        onClick={() => deleteAnnotation(a.id)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded text-fg-faint hover:text-status-rejected hover:bg-status-rejected/15 opacity-0 group-hover/nested:opacity-100 transition-opacity"
                        aria-label="Delete comment"
                      >
                        <svg
                          className="h-2.5 w-2.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {standaloneAnnotations.length > 0 && (
          <div className="flex flex-col">
            <div className="px-1 pb-0.5 flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-status-modified/80">
                Comments
              </span>
              <span className="text-[9px] tabular-nums text-fg-muted/40">
                {standaloneAnnotations.length}
              </span>
            </div>
            <div className="max-h-28 overflow-y-auto scrollbar-thin flex flex-col gap-px">
              {standaloneAnnotations.map((a) => (
                <div
                  key={a.id}
                  className="group/item relative rounded-r border-l-2 border-l-status-modified/30 hover:border-l-status-modified/70 hover:bg-surface-hover/60 transition-colors"
                >
                  <button
                    onClick={() => goToFile(a.filePath)}
                    className="w-full text-left pl-1.5 pr-5 py-0.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <FilePathLabel filePath={a.filePath} />
                      <span className="shrink-0 text-[9px] tabular-nums text-fg-muted/40 bg-surface-raised/60 rounded px-1 py-px">
                        {a.lineNumber}
                      </span>
                    </div>
                    <p className="text-[10px] leading-snug text-fg-muted/70 mt-px line-clamp-2">
                      {a.content}
                    </p>
                  </button>
                  <button
                    onClick={() => deleteAnnotation(a.id)}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded text-fg-faint hover:text-status-rejected hover:bg-status-rejected/15 opacity-0 group-hover/item:opacity-100 transition-opacity"
                    aria-label="Delete comment"
                  >
                    <svg
                      className="h-2.5 w-2.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
