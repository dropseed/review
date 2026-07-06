import {
  type ReactNode,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useFeedbackPanel } from "../../hooks";
import { CollapsibleSection } from "../ui/collapsible-section";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { SimpleTooltip } from "../ui/tooltip";
import { FilePathLabel } from "./file-path-label";
import { lineRangeRef } from "../../utils/line-range";
import type { Source, LineAnnotation } from "../../types";

const COMMENTS_ICON = (
  <svg
    className="h-3.5 w-3.5 text-fg-muted"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
  </svg>
);

/** Tone for an author tag, keyed on where the comment came from. */
function authorTone(source: Source | undefined): string {
  switch (source) {
    case "agent":
      return "text-status-modified/80";
    case "github":
    case "gitlab":
      return "text-status-renamed/70";
    default:
      return "text-fg-muted/60";
  }
}

interface CommentRowProps {
  annotation: LineAnnotation;
  resolved: boolean;
  onGoTo: () => void;
  onToggleResolved: () => void;
  onDelete: () => void;
}

function CommentRow({
  annotation,
  resolved,
  onGoTo,
  onToggleResolved,
  onDelete,
}: CommentRowProps): ReactNode {
  return (
    <div
      className={`group/c relative rounded-r border-l-2 transition-colors ${
        resolved
          ? "border-l-edge-default opacity-60 hover:opacity-100 hover:bg-surface-hover/60"
          : "border-l-status-modified/30 hover:border-l-status-modified/70 hover:bg-surface-hover/60"
      }`}
    >
      <button onClick={onGoTo} className="w-full text-left pl-1.5 pr-11 py-1">
        <div className="flex items-center gap-1.5">
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <FilePathLabel
              filePath={annotation.filePath}
              filenameHoverClass="group-hover/c:text-fg"
            />
            {annotation.author && (
              <span
                className={`shrink-0 truncate text-[9px] ${authorTone(
                  annotation.source,
                )}`}
              >
                {annotation.author}
              </span>
            )}
          </span>
          <span className="shrink-0 rounded bg-surface-raised/60 px-1 py-px text-[9px] tabular-nums text-fg-muted/40">
            {lineRangeRef(annotation.lineNumber, annotation.endLineNumber)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[10px] leading-snug text-fg-muted/80">
          {annotation.content}
        </p>
      </button>
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover/c:opacity-100">
        <SimpleTooltip content={resolved ? "Unresolve" : "Resolve"}>
          <button
            onClick={onToggleResolved}
            className={`rounded p-0.5 text-fg-faint ${
              resolved
                ? "hover:bg-status-modified/15 hover:text-status-modified"
                : "hover:bg-status-approved/15 hover:text-status-approved"
            }`}
            aria-label={resolved ? "Unresolve comment" : "Resolve comment"}
          >
            {resolved ? (
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
                  d="M9 14L4 9l5-5M20 20v-7a4 4 0 00-4-4H4"
                />
              </svg>
            ) : (
              <svg
                className="h-2.5 w-2.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            )}
          </button>
        </SimpleTooltip>
        <SimpleTooltip content="Delete">
          <button
            onClick={onDelete}
            className="rounded p-0.5 text-fg-faint hover:bg-status-rejected/15 hover:text-status-rejected"
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
        </SimpleTooltip>
      </div>
    </div>
  );
}

/**
 * Top-level "Comments" panel section: every line comment on the review, open
 * ones up front and resolved ones tucked into a collapsed subsection. Comments
 * on rejected hunks appear here too — the rejected hunk itself shows under
 * Reviewed.
 */
export function ReviewCommentsPanel(): ReactNode {
  const {
    openComments,
    resolvedAnnotations,
    goToFile,
    resolveAnnotation,
    unresolveAnnotation,
    deleteAnnotation,
    resolveAllAnnotations,
    deleteResolvedAnnotations,
  } = useFeedbackPanel();

  const [isOpen, setIsOpen] = useState(true);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  const startDeleteConfirmation = useCallback(() => {
    setConfirmingDelete(true);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(
      () => setConfirmingDelete(false),
      3000,
    );
  }, []);

  const confirmDeleteResolved = useCallback(() => {
    deleteResolvedAnnotations();
    setConfirmingDelete(false);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
  }, [deleteResolvedAnnotations]);

  const isEmpty = openComments.length === 0 && resolvedAnnotations.length === 0;
  const hasOpen = openComments.length > 0;
  const hasResolved = resolvedAnnotations.length > 0;

  const menuContent = (
    <>
      <DropdownMenuItem
        disabled={!hasOpen}
        onClick={() => {
          if (hasOpen) resolveAllAnnotations();
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
            d="M4.5 12.75l6 6 9-13.5"
          />
        </svg>
        Resolve all
      </DropdownMenuItem>
      {confirmingDelete && hasResolved ? (
        <DropdownMenuItem
          onClick={confirmDeleteResolved}
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
          Confirm — delete {resolvedAnnotations.length} resolved
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          disabled={!hasResolved}
          onSelect={(e) => {
            if (hasResolved) e.preventDefault();
          }}
          onClick={() => {
            if (hasResolved) startDeleteConfirmation();
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
          Delete resolved
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <CollapsibleSection
      title="Comments"
      icon={COMMENTS_ICON}
      badge={openComments.length || undefined}
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      menuContent={menuContent}
      onMenuOpenChange={(open) => {
        // Drop a pending delete-confirm when the menu is dismissed, so
        // reopening it never shows the destructive item pre-armed.
        if (!open) setConfirmingDelete(false);
      }}
    >
      <div className="flex flex-col gap-px px-2 pb-2">
        {isEmpty && (
          <div className="px-1 py-3 text-center">
            <p className="text-[11px] text-fg-muted">No comments yet</p>
            <p className="mt-0.5 text-[10px] text-fg-muted/50">
              Add one from any line in the diff
            </p>
          </div>
        )}

        {openComments.length > 0 && (
          <div className="max-h-64 overflow-y-auto scrollbar-thin flex flex-col gap-px">
            {openComments.map((a) => (
              <CommentRow
                key={a.id}
                annotation={a}
                resolved={false}
                onGoTo={() => goToFile(a.filePath)}
                onToggleResolved={() => resolveAnnotation(a.id)}
                onDelete={() => deleteAnnotation(a.id)}
              />
            ))}
          </div>
        )}

        {resolvedAnnotations.length > 0 && (
          <div className="flex flex-col">
            <button
              onClick={() => setResolvedOpen((v) => !v)}
              className="flex items-center gap-1.5 px-1 pb-0.5 pt-1 text-left hover:opacity-80"
            >
              <svg
                className={`h-2.5 w-2.5 text-fg-muted/50 transition-transform ${
                  resolvedOpen ? "rotate-90" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="text-[10px] font-medium text-fg-muted/70">
                Resolved
              </span>
              <span className="text-[9px] tabular-nums text-fg-muted/40">
                {resolvedAnnotations.length}
              </span>
            </button>
            {resolvedOpen && (
              <div className="max-h-48 overflow-y-auto scrollbar-thin flex flex-col gap-px">
                {resolvedAnnotations.map((a) => (
                  <CommentRow
                    key={a.id}
                    annotation={a}
                    resolved
                    onGoTo={() => goToFile(a.filePath)}
                    onToggleResolved={() => unresolveAnnotation(a.id)}
                    onDelete={() => deleteAnnotation(a.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
