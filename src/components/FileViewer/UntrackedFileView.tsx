import { useState, useMemo } from "react";
import { File as PierreFile } from "@pierre/diffs/react";
import type { LineAnnotation as PierreLineAnnotation } from "@pierre/diffs/react";
import { SimpleTooltip } from "../ui/tooltip";
import { useReviewStore } from "../../stores";
import type { DiffHunk, LineAnnotation } from "../../types";
import { isHunkTrusted } from "../../types";
import {
  AnnotationEditor,
  AnnotationDisplay,
} from "./annotations/AnnotationEditor";
import type { SupportedLanguages } from "./languageMap";

// Metadata for annotations in untracked file view
type UntrackedAnnotationMeta =
  | { type: "user"; data: { annotation: LineAnnotation } }
  | { type: "new"; data: Record<string, never> };

/** Returns the appropriate header background class based on hunk state */
function getHeaderBackgroundClass(
  isRejected: boolean,
  isApproved: boolean,
  isTrusted: boolean,
): string {
  if (isRejected) return "bg-rose-500/10";
  if (isApproved) return "bg-emerald-500/5 bg-stone-900/95";
  if (isTrusted) return "bg-sky-500/5 bg-stone-900/95";
  return "bg-stone-900/95";
}

interface UntrackedFileViewProps {
  content: string;
  filePath: string;
  hunks: DiffHunk[];
  theme: string;
  fontSizeCSS: string;
  /** Language override for syntax highlighting */
  language?: SupportedLanguages;
  /** Annotations for this file */
  annotations?: LineAnnotation[];
  /** Callback when adding a new annotation */
  onAddAnnotation?: (lineNumber: number, content: string) => void;
  /** Callback when updating an annotation */
  onUpdateAnnotation?: (id: string, content: string) => void;
  /** Callback when deleting an annotation */
  onDeleteAnnotation?: (id: string) => void;
}

export function UntrackedFileView({
  content,
  filePath,
  hunks,
  theme,
  fontSizeCSS,
  language,
  annotations = [],
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
}: UntrackedFileViewProps) {
  const {
    reviewState,
    approveHunk,
    unapproveHunk,
    rejectHunk,
    unrejectHunk,
    hunks: allHunks,
    setSelectedFile,
  } = useReviewStore();

  // Get the synthetic hunk for this untracked file
  const hunk = hunks[0];
  const hunkState = reviewState?.hunks[hunk?.id];
  const isApproved = hunkState?.status === "approved";
  const isRejected = hunkState?.status === "rejected";
  const isTrusted =
    !hunkState?.status &&
    isHunkTrusted(hunkState, reviewState?.trustList ?? []);

  const lineCount = content.split("\n").length;

  // Move pair detection — use the store hunk (which has movePairId set
  // by batch detect_move_pairs) rather than the per-file response hunk
  const storeHunk = hunk ? allHunks.find((h) => h.id === hunk.id) : undefined;
  const pairedHunk = storeHunk?.movePairId
    ? allHunks.find((h) => h.id === storeHunk.movePairId)
    : undefined;

  // Annotation state
  const [newAnnotationLine, setNewAnnotationLine] = useState<number | null>(
    null,
  );
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(
    null,
  );

  // Filter annotations for file view (side === "file")
  const fileAnnotations = useMemo(() => {
    return annotations.filter((a) => a.side === "file");
  }, [annotations]);

  // Build line annotations for PierreFile
  const lineAnnotations: PierreLineAnnotation<UntrackedAnnotationMeta>[] =
    useMemo(() => {
      const items: PierreLineAnnotation<UntrackedAnnotationMeta>[] = [];
      for (const annotation of fileAnnotations) {
        items.push({
          lineNumber: annotation.lineNumber,
          metadata: { type: "user", data: { annotation } },
        });
      }
      if (newAnnotationLine !== null) {
        items.push({
          lineNumber: newAnnotationLine,
          metadata: { type: "new", data: {} },
        });
      }
      return items;
    }, [fileAnnotations, newAnnotationLine]);

  const handleSaveNewAnnotation = (annotationContent: string) => {
    if (newAnnotationLine === null || !onAddAnnotation) return;
    onAddAnnotation(newAnnotationLine, annotationContent);
    setNewAnnotationLine(null);
  };

  const renderAnnotation = (
    annotation: PierreLineAnnotation<UntrackedAnnotationMeta>,
  ) => {
    const meta = annotation.metadata!;
    if (meta.type === "new") {
      return (
        <AnnotationEditor
          onSave={handleSaveNewAnnotation}
          onCancel={() => setNewAnnotationLine(null)}
          autoFocus
        />
      );
    }
    const { annotation: userAnnotation } = meta.data;
    const isEditing = editingAnnotationId === userAnnotation.id;
    if (isEditing) {
      return (
        <AnnotationEditor
          initialContent={userAnnotation.content}
          onSave={(annotationContent) => {
            onUpdateAnnotation?.(userAnnotation.id, annotationContent);
            setEditingAnnotationId(null);
          }}
          onCancel={() => setEditingAnnotationId(null)}
          onDelete={() => {
            onDeleteAnnotation?.(userAnnotation.id);
            setEditingAnnotationId(null);
          }}
          autoFocus
        />
      );
    }
    return (
      <AnnotationDisplay
        annotation={userAnnotation}
        onEdit={() => setEditingAnnotationId(userAnnotation.id)}
        onDelete={() => onDeleteAnnotation?.(userAnnotation.id)}
      />
    );
  };

  function renderActionButtons(): JSX.Element {
    if (isApproved) {
      return (
        <SimpleTooltip content="Click to unapprove">
          <button
            onClick={() => unapproveHunk(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-all hover:bg-emerald-500/30 inset-ring-1 inset-ring-emerald-500/30 animate-in fade-in zoom-in-95 duration-200"
          >
            <svg
              className="h-3.5 w-3.5"
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
            <span>Approved</span>
          </button>
        </SimpleTooltip>
      );
    }

    if (isRejected) {
      return (
        <SimpleTooltip content="Click to clear rejection">
          <button
            onClick={() => unrejectHunk(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-300 transition-all hover:bg-rose-500/30 inset-ring-1 inset-ring-rose-500/30 animate-in fade-in zoom-in-95 duration-200"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span>Rejected</span>
          </button>
        </SimpleTooltip>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <SimpleTooltip content="Reject this change">
          <button
            onClick={() => rejectHunk(hunk.id)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all active:scale-95 ${
              isTrusted
                ? "text-stone-500/50 bg-stone-700/20 hover:bg-rose-500/20 hover:text-rose-400"
                : "text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 hover:text-rose-300"
            }`}
            aria-label="Reject change"
          >
            <svg
              className={`h-3 w-3${isTrusted ? " opacity-50" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span>Reject</span>
          </button>
        </SimpleTooltip>
        <SimpleTooltip content="Approve this change">
          <button
            onClick={() => approveHunk(hunk.id)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all active:scale-95 ${
              isTrusted
                ? "text-stone-500/50 bg-stone-700/20 hover:bg-emerald-500/20 hover:text-emerald-400"
                : "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-300"
            }`}
            aria-label="Approve change"
          >
            <svg
              className={`h-3 w-3${isTrusted ? " opacity-50" : ""}`}
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
            <span>Approve</span>
          </button>
        </SimpleTooltip>
      </div>
    );
  }

  const renderHoverUtility = (
    getHoveredLine: () => { lineNumber: number } | undefined,
  ) => {
    if (!onAddAnnotation) return null;
    return (
      <SimpleTooltip content="Add comment">
        <button
          className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/80 text-white shadow-lg transition-all hover:bg-sky-500 hover:scale-110"
          onClick={() => {
            const hoveredLine = getHoveredLine();
            if (!hoveredLine) return;
            setNewAnnotationLine(hoveredLine.lineNumber);
          }}
          aria-label="Add comment"
        >
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
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </button>
      </SimpleTooltip>
    );
  };

  return (
    <div>
      {/* Approval controls */}
      {hunk && (
        <div
          className={`sticky top-0 z-10 mb-2 flex items-center gap-3 border-b border-stone-800/50 backdrop-blur-xs p-3 ${getHeaderBackgroundClass(isRejected, isApproved, isTrusted)}`}
        >
          <span className="font-mono text-xs text-emerald-500 tabular-nums">
            + {lineCount} lines (new file)
          </span>
          {hunkState?.label && hunkState.label.length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
              {hunkState.label.join(", ")}
            </span>
          )}
          {pairedHunk && (
            <SimpleTooltip content={`Jump to source in ${pairedHunk.filePath}`}>
              <button
                onClick={() => setSelectedFile(pairedHunk.filePath)}
                className="flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-400 transition-all hover:bg-sky-500/25"
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
                    d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                  />
                </svg>
                <span>Moved from</span>
                <span className="opacity-60">
                  {pairedHunk.filePath.split("/").pop()}
                </span>
              </button>
            </SimpleTooltip>
          )}

          {/* Action buttons - matching HunkAnnotationPanel style */}
          {renderActionButtons()}
        </div>
      )}

      {/* File content using pierre/diffs */}
      <PierreFile
        file={{
          name: filePath,
          contents: content,
          lang: language,
          cacheKey: `untracked:${filePath}:${content.length}`,
        }}
        lineAnnotations={lineAnnotations}
        renderAnnotation={renderAnnotation}
        renderHoverUtility={renderHoverUtility}
        options={{
          theme: {
            dark: theme,
            light: theme,
          },
          themeType: "dark",
          disableFileHeader: true,
          unsafeCSS: fontSizeCSS,
          enableHoverUtility: true,
        }}
      />
    </div>
  );
}
