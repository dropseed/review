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

/**
 * Top-level "Notes" panel section: the free-form review notes textarea. Line
 * comments live in `ReviewCommentsPanel`; copying/submitting the whole review
 * is the bottom action bar's job.
 */
export function ReviewNotesPanel(): ReactNode {
  const { notes, setReviewNotes, hasClearableFeedback, clearFeedback } =
    useFeedbackPanel();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isOpen, setIsOpen] = useState(true);
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

  const menuContent = confirmingClear ? (
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
      Confirm — keeps resolved &amp; agent comments
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem
      disabled={!hasClearableFeedback}
      onSelect={(e) => {
        if (hasClearableFeedback) e.preventDefault();
      }}
      onClick={() => {
        if (hasClearableFeedback) startClearConfirmation();
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
      Clear notes &amp; my comments
    </DropdownMenuItem>
  );

  return (
    <CollapsibleSection
      title="Notes"
      icon={NOTES_ICON}
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      menuContent={menuContent}
      onMenuOpenChange={(open) => {
        // Drop a pending clear-confirm when the menu is dismissed.
        if (!open) setConfirmingClear(false);
      }}
    >
      <div className="px-2 pb-2">
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
      </div>
    </CollapsibleSection>
  );
}
