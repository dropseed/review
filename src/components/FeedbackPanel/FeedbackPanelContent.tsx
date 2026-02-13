import type { LineAnnotation } from "../../types";
import { SimpleTooltip } from "../ui/tooltip";
import { Textarea } from "../ui/textarea";

// Annotation list item with refined hover states
function AnnotationItem({
  annotation,
  onGoTo,
  onDelete,
}: {
  annotation: LineAnnotation;
  onGoTo: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative rounded-md bg-stone-900/60 border border-stone-800/60 hover:border-stone-700/80 hover:bg-stone-800/40 transition-all duration-150">
      <SimpleTooltip content="Go to this line">
        <button
          onClick={onGoTo}
          className="w-full text-left p-2.5 pr-8 min-w-0 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-amber-500/50 rounded-md"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <svg
              className="h-3 w-3 text-amber-500/70 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            <span className="text-xxs font-mono text-amber-400/90 truncate tabular-nums">
              {annotation.filePath}:{annotation.lineNumber}
              {annotation.endLineNumber ? `-${annotation.endLineNumber}` : ""}
            </span>
          </div>
          <p className="text-xs text-stone-300 line-clamp-2 leading-relaxed">
            {annotation.content}
          </p>
        </button>
      </SimpleTooltip>
      <SimpleTooltip content="Delete comment">
        <button
          onClick={onDelete}
          className="absolute top-2 right-2 p-1 text-stone-600 hover:text-rose-400 hover:bg-rose-500/15 rounded opacity-0 group-hover:opacity-100 transition-all duration-150 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-rose-500/50"
          aria-label="Delete comment"
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </SimpleTooltip>
    </div>
  );
}

interface RejectedHunkItem {
  filePath: string;
  lineRange: string;
  hunkId: string;
}

interface FeedbackPanelProps {
  notes: string;
  onNotesChange: (notes: string) => void;
  rejectedHunks: RejectedHunkItem[];
  onGoToRejectedHunk: (filePath: string) => void;
  annotations: LineAnnotation[];
  onGoToAnnotation: (annotation: LineAnnotation) => void;
  onDeleteAnnotation: (annotationId: string) => void;
}

// Feedback panel - shows notes textarea, rejected hunks, and line annotations list
export function FeedbackPanelContent({
  notes,
  onNotesChange,
  rejectedHunks,
  onGoToRejectedHunk,
  annotations,
  onGoToAnnotation,
  onDeleteAnnotation,
}: FeedbackPanelProps) {
  return (
    <div className="p-3 space-y-4">
      {/* Review notes section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <svg
            className="h-3.5 w-3.5 text-stone-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
            />
          </svg>
          <label
            htmlFor="review-notes"
            className="text-xxs font-medium text-stone-400 uppercase tracking-wide"
          >
            Notes
          </label>
        </div>
        <div className="relative">
          <Textarea
            id="review-notes"
            placeholder="Overall observations, summary, questions…"
            className="h-20 text-xs leading-relaxed resize-none bg-stone-900/80 border-stone-800/80 focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/10 focus:bg-stone-900"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
          />
          {notes.length > 0 && (
            <div className="absolute bottom-2 right-2 text-xxs text-stone-600 tabular-nums pointer-events-none">
              {notes.length}
            </div>
          )}
        </div>
      </div>

      {/* Rejected hunks section */}
      {rejectedHunks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <svg
              className="h-3.5 w-3.5 text-rose-500/70"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <label className="text-xxs font-medium text-stone-400 uppercase tracking-wide">
              Changes Requested
            </label>
            <span className="ml-auto px-1.5 py-0.5 text-xxs font-medium tabular-nums rounded bg-rose-500/15 text-rose-300">
              {rejectedHunks.length}
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-1.5 -mx-0.5 px-0.5">
            {rejectedHunks.map((item) => (
              <SimpleTooltip key={item.hunkId} content="Go to this change">
                <button
                  onClick={() => onGoToRejectedHunk(item.filePath)}
                  className="w-full text-left p-2.5 min-w-0 rounded-md bg-stone-900/60 border border-stone-800/60 hover:border-rose-500/30 hover:bg-stone-800/40 transition-all duration-150 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-rose-500/50"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500/70 flex-shrink-0" />
                    <span className="text-xxs font-mono text-rose-400/90 truncate tabular-nums">
                      {item.filePath}:{item.lineRange}
                    </span>
                  </div>
                </button>
              </SimpleTooltip>
            ))}
          </div>
        </div>
      )}

      {/* Line comments section */}
      {annotations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <svg
              className="h-3.5 w-3.5 text-stone-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
              />
            </svg>
            <label className="text-xxs font-medium text-stone-400 uppercase tracking-wide">
              Line Comments
            </label>
            <span className="ml-auto px-1.5 py-0.5 text-xxs font-medium tabular-nums rounded bg-amber-500/15 text-amber-300">
              {annotations.length}
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-1.5 -mx-0.5 px-0.5">
            {annotations.map((annotation) => (
              <AnnotationItem
                key={annotation.id}
                annotation={annotation}
                onGoTo={() => onGoToAnnotation(annotation)}
                onDelete={() => onDeleteAnnotation(annotation.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state when no feedback */}
      {!notes && rejectedHunks.length === 0 && annotations.length === 0 && (
        <div className="py-2 text-center">
          <p className="text-xxs text-stone-600 italic">
            Add notes or click lines in the diff to comment
          </p>
        </div>
      )}
    </div>
  );
}
