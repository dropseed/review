import type { LineAnnotation } from "../../types";

// Annotation list item
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
    <div className="group rounded bg-stone-800/50 p-2 mb-1.5">
      <div className="flex items-start gap-2">
        <button
          onClick={onGoTo}
          className="flex-1 text-left min-w-0"
          title="Go to this line"
        >
          <div className="text-xxs font-mono text-amber-400 mb-0.5 truncate tabular-nums">
            {annotation.filePath}:{annotation.lineNumber}
          </div>
          <p className="text-xs text-stone-300 line-clamp-2 text-pretty">
            {annotation.content}
          </p>
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-stone-600 hover:text-rose-400 hover:bg-rose-500/20 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
          title="Delete annotation"
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
      </div>
    </div>
  );
}

interface FeedbackPanelProps {
  notes: string;
  onNotesChange: (notes: string) => void;
  annotations: LineAnnotation[];
  onGoToAnnotation: (annotation: LineAnnotation) => void;
  onDeleteAnnotation: (annotationId: string) => void;
}

// Feedback panel - shows notes textarea and line annotations list
export function FeedbackPanel({
  notes,
  onNotesChange,
  annotations,
  onGoToAnnotation,
  onDeleteAnnotation,
}: FeedbackPanelProps) {
  return (
    <div className="space-y-3">
      {/* Review notes textarea */}
      <div>
        <label className="text-xxs font-medium text-stone-400 mb-1 block">
          Review Notes
        </label>
        <textarea
          placeholder="Overall observations, summary…"
          className="input h-16 w-full resize-none text-xs"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </div>

      {/* Annotations list */}
      {annotations.length > 0 && (
        <div>
          <label className="text-xxs font-medium text-stone-400 mb-1 block">
            Comments ({annotations.length})
          </label>
          <div className="max-h-32 overflow-y-auto scrollbar-thin">
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
    </div>
  );
}
