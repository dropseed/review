import { useState, useRef, useEffect } from "react";
import { useListContinuation } from "../../../hooks";
import type { Source, LineAnnotation } from "../../../types";
import { SimpleTooltip } from "../../ui/tooltip";

interface AnnotationEditorProps {
  initialContent?: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
  autoFocus?: boolean;
}

// Annotation editor for adding/editing inline comments
export function AnnotationEditor({
  initialContent,
  onSave,
  onCancel,
  onDelete,
  autoFocus,
}: AnnotationEditorProps) {
  const [value, setValue] = useState(initialContent || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleListKeyDown = useListContinuation(textareaRef, setValue);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (value.trim()) {
        onSave(value.trim());
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else {
      handleListKeyDown(e);
    }
  };

  return (
    <div className="border-l-2 border-status-modified/50 bg-surface-panel/95 p-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment…"
        className="w-full h-16 bg-surface-raised border border-edge-default rounded px-2 py-1.5 text-xs text-fg-secondary placeholder-fg-muted resize-none focus:outline-hidden focus:border-focus-ring/50"
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xxs text-fg-faint">
          {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to save
        </span>
        <div className="flex gap-1">
          {onDelete && (
            <button
              onClick={onDelete}
              className="px-2 py-1 text-xs text-status-rejected hover:bg-status-rejected/20 rounded transition-colors"
            >
              Delete
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (value.trim()) onSave(value.trim());
            }}
            disabled={!value.trim()}
            className="px-2 py-1 text-xs font-medium text-fg bg-status-modified hover:bg-status-modified rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface AnnotationDisplayProps {
  annotation: LineAnnotation;
  onEdit: () => void;
  onDelete: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
}

// Display component for existing annotations
export function AnnotationDisplay({
  annotation,
  onEdit,
  onDelete,
  onResolve,
  onUnresolve,
}: AnnotationDisplayProps) {
  const resolved = !!annotation.resolvedAt;
  const containerClass = resolved
    ? "border-l-2 border-edge-default bg-surface-panel/40 px-3 py-2 group opacity-60"
    : "border-l-2 border-status-modified/50 bg-status-modified/5 px-3 py-2 group";
  return (
    <div className={containerClass}>
      <div className="flex items-start gap-2">
        <svg
          className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${
            resolved ? "text-fg-muted" : "text-status-modified"
          }`}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
        <div className="flex-1 min-w-0">
          {(annotation.author || resolved) && (
            <div className="flex items-center gap-1.5 mb-1">
              {annotation.author && (
                <AnnotationAuthorChip
                  author={annotation.author}
                  source={annotation.source}
                />
              )}
              {resolved && (
                <span className="text-xxs text-fg-faint">
                  resolved
                  {annotation.resolvedBy ? ` by ${annotation.resolvedBy}` : ""}
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-fg-secondary whitespace-pre-wrap text-pretty">
            {annotation.content}
          </p>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onResolve && !resolved && (
            <SimpleTooltip content="Resolve">
              <button
                onClick={onResolve}
                className="p-1 text-fg-muted hover:text-status-approved hover:bg-status-approved/20 rounded transition-colors"
                aria-label="Resolve annotation"
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
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
              </button>
            </SimpleTooltip>
          )}
          {onUnresolve && resolved && (
            <SimpleTooltip content="Unresolve">
              <button
                onClick={onUnresolve}
                className="p-1 text-fg-muted hover:text-fg-secondary hover:bg-surface-hover rounded transition-colors"
                aria-label="Unresolve annotation"
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
                    d="M9 14L4 9l5-5M20 20v-7a4 4 0 00-4-4H4"
                  />
                </svg>
              </button>
            </SimpleTooltip>
          )}
          <SimpleTooltip content="Edit">
            <button
              onClick={onEdit}
              className="p-1 text-fg-muted hover:text-fg-secondary hover:bg-surface-hover rounded transition-colors"
              aria-label="Edit annotation"
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
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                />
              </svg>
            </button>
          </SimpleTooltip>
          <SimpleTooltip content="Delete">
            <button
              onClick={onDelete}
              className="p-1 text-fg-muted hover:text-status-rejected hover:bg-status-rejected/20 rounded transition-colors"
              aria-label="Delete annotation"
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
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                />
              </svg>
            </button>
          </SimpleTooltip>
        </div>
      </div>
    </div>
  );
}

// Author + source chip rendered above an annotation's content.
function AnnotationAuthorChip({
  author,
  source,
}: {
  author: string;
  source?: Source;
}) {
  const tone = sourceToneClass(source);
  const label = sourceLabel(source);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-1 py-px text-xxs ${tone}`}
    >
      <span className="font-medium">{author}</span>
      {label && <span className="opacity-70">·&nbsp;{label}</span>}
    </span>
  );
}

function sourceToneClass(source?: Source): string {
  switch (source) {
    case "agent":
      return "bg-status-modified/15 text-status-modified";
    case "github":
    case "gitlab":
      return "bg-surface-raised text-fg-secondary";
    case "cli":
      return "bg-surface-raised text-fg-secondary";
    case "ui":
    default:
      return "bg-surface-raised text-fg-secondary";
  }
}

function sourceLabel(source?: Source): string | null {
  switch (source) {
    case "agent":
      return "agent";
    case "cli":
      return "cli";
    case "github":
      return "github";
    case "gitlab":
      return "gitlab";
    default:
      return null;
  }
}
