import { useState, useMemo, Component, ReactNode } from "react";
import { PatchDiff, MultiFileDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileContents } from "@pierre/diffs/react";
import { useReviewStore } from "../../stores/reviewStore";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { DiffHunk, HunkState, LineAnnotation } from "../../types";
import { isHunkTrusted } from "../../types";
import { OverflowMenu } from "./OverflowMenu";
import { AnnotationEditor, AnnotationDisplay } from "./AnnotationEditor";
import { detectLanguage } from "./languageMap";

// Error boundary to catch rendering errors
export class DiffErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[DiffErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Metadata for hunk annotations
interface HunkAnnotationMeta {
  hunk: DiffHunk;
  hunkState: HunkState | undefined;
  pairedHunk: DiffHunk | null;
  isSource: boolean;
}

// Metadata for user annotations
interface UserAnnotationMeta {
  annotation: LineAnnotation;
}

// Combined annotation type for rendering
type AnnotationMeta =
  | { type: "hunk"; data: HunkAnnotationMeta }
  | { type: "user"; data: UserAnnotationMeta }
  | { type: "new"; data: Record<string, never> };

interface DiffViewProps {
  diffPatch: string;
  viewMode: "unified" | "split";
  hunks: DiffHunk[];
  theme: string;
  fontSizeCSS: string;
  onViewInFile?: (line: number) => void;
  // File contents for expansion support
  fileName: string;
  oldContent?: string;
  newContent?: string;
}

export function DiffView({
  diffPatch,
  viewMode,
  hunks,
  theme,
  fontSizeCSS,
  onViewInFile,
  fileName,
  oldContent,
  newContent,
}: DiffViewProps) {
  const {
    reviewState,
    approveHunk,
    unapproveHunk,
    rejectHunk,
    unrejectHunk,
    hunks: allHunks,
    setSelectedFile,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    classifyingHunkIds,
  } = useReviewStore();

  // Annotation editing state
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(
    null,
  );
  const [newAnnotationLine, setNewAnnotationLine] = useState<{
    lineNumber: number;
    side: "old" | "new";
    hunkId: string;
  } | null>(null);

  // Get the file path from the first hunk
  const filePath = hunks[0]?.filePath ?? "";

  // Get annotations for this file
  const annotations = reviewState?.annotations ?? [];
  const fileAnnotations = useMemo(() => {
    return annotations.filter((a) => a.filePath === filePath);
  }, [annotations, filePath]);

  // Helper to determine if hunk is deletion-only (source of move)
  const isDeletionOnly = (hunk: DiffHunk) =>
    hunk.lines.every((l) => l.type === "removed" || l.type === "context") &&
    hunk.lines.some((l) => l.type === "removed");

  // Build line annotations for each hunk - position at first changed line
  const hunkAnnotations: DiffLineAnnotation<AnnotationMeta>[] = hunks.map(
    (hunk) => {
      const hunkState = reviewState?.hunks[hunk.id];
      const pairedHunk = hunk.movePairId
        ? (allHunks.find((h) => h.id === hunk.movePairId) ?? null)
        : null;
      const isSource = pairedHunk ? isDeletionOnly(hunk) : false;

      // Find the first changed line (added or removed) to position annotation there
      const firstChangedLine = hunk.lines.find(
        (l) => l.type === "added" || l.type === "removed",
      );
      const lineNumber = isSource
        ? (firstChangedLine?.oldLineNumber ?? hunk.oldStart)
        : (firstChangedLine?.newLineNumber ?? hunk.newStart);

      return {
        side: isSource ? ("deletions" as const) : ("additions" as const),
        lineNumber,
        metadata: {
          type: "hunk" as const,
          data: { hunk, hunkState, pairedHunk, isSource },
        },
      };
    },
  );

  // Build annotations for user comments
  const userAnnotations: DiffLineAnnotation<AnnotationMeta>[] =
    fileAnnotations.map((annotation) => ({
      side:
        annotation.side === "old"
          ? ("deletions" as const)
          : ("additions" as const),
      lineNumber: annotation.lineNumber,
      metadata: { type: "user" as const, data: { annotation } },
    }));

  // Add new annotation editor if active
  const newAnnotationEditorItem: DiffLineAnnotation<AnnotationMeta>[] =
    newAnnotationLine
      ? [
          {
            side:
              newAnnotationLine.side === "old"
                ? ("deletions" as const)
                : ("additions" as const),
            lineNumber: newAnnotationLine.lineNumber,
            metadata: { type: "new" as const, data: {} },
          },
        ]
      : [];

  // Combine all annotations
  const lineAnnotations: DiffLineAnnotation<AnnotationMeta>[] = [
    ...hunkAnnotations,
    ...userAnnotations,
    ...newAnnotationEditorItem,
  ];

  // Handle jumping to paired hunk
  const handleJumpToPair = (movePairId: string) => {
    const pairedHunk = allHunks.find((h) => h.id === movePairId);
    if (pairedHunk) {
      setSelectedFile(pairedHunk.filePath);
    }
  };

  const handleCopyHunk = async (hunk: DiffHunk) => {
    await writeText(hunk.content);
  };

  // Handle saving a new annotation
  const handleSaveNewAnnotation = (content: string) => {
    if (!newAnnotationLine) return;
    addAnnotation(
      filePath,
      newAnnotationLine.lineNumber,
      newAnnotationLine.side,
      content,
    );
    setNewAnnotationLine(null);
  };

  // Render annotation for each type
  const renderAnnotation = (annotation: DiffLineAnnotation<AnnotationMeta>) => {
    const meta = annotation.metadata!;

    // Handle new annotation editor
    if (meta.type === "new") {
      return (
        <AnnotationEditor
          onSave={handleSaveNewAnnotation}
          onCancel={() => setNewAnnotationLine(null)}
          autoFocus
        />
      );
    }

    // Handle user annotations
    if (meta.type === "user") {
      const { annotation: userAnnotation } = meta.data;
      const isEditing = editingAnnotationId === userAnnotation.id;

      if (isEditing) {
        return (
          <AnnotationEditor
            initialContent={userAnnotation.content}
            onSave={(content) => {
              updateAnnotation(userAnnotation.id, content);
              setEditingAnnotationId(null);
            }}
            onCancel={() => setEditingAnnotationId(null)}
            onDelete={() => {
              deleteAnnotation(userAnnotation.id);
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
          onDelete={() => deleteAnnotation(userAnnotation.id)}
        />
      );
    }

    // Handle hunk annotations
    const { hunk, hunkState, pairedHunk, isSource } = meta.data;
    const isApproved = hunkState?.status === "approved";
    const isRejected = hunkState?.status === "rejected";
    const isTrusted =
      !hunkState?.status &&
      isHunkTrusted(hunkState, reviewState?.trustList ?? []);

    return (
      <div
        className={`flex items-center gap-2 px-3 py-1.5 border-b border-stone-700/50 ${
          isRejected
            ? "bg-rose-500/10"
            : isApproved
              ? "bg-lime-500/5"
              : isTrusted
                ? "bg-sky-500/5"
                : "bg-stone-800/80"
        }`}
      >
        {/* Trust labels with reasoning tooltip */}
        {hunkState?.label?.map((lbl, i) => (
          <span
            key={i}
            className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400 cursor-help"
            title={hunkState?.reasoning || undefined}
          >
            {lbl}
          </span>
        ))}

        {/* Classifying indicator */}
        {classifyingHunkIds.has(hunk.id) && (
          <div className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5">
            <svg
              className="h-3 w-3 animate-spin text-violet-400"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-xxs text-violet-400">Classifying…</span>
          </div>
        )}

        {/* Move indicator */}
        {pairedHunk && (
          <button
            onClick={() => handleJumpToPair(hunk.movePairId!)}
            className="flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-400 transition-all hover:bg-sky-500/25"
            title={`Jump to ${isSource ? "destination" : "source"} in ${pairedHunk.filePath}`}
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {isSource ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                />
              )}
            </svg>
            <span>{isSource ? "Moved to" : "Moved from"}</span>
            <span className="opacity-60">
              {pairedHunk.filePath.split("/").pop()}
            </span>
          </button>
        )}

        {/* Action buttons - grouped with keyboard shortcuts */}
        {isApproved ? (
          <button
            onClick={() => unapproveHunk(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-lime-500/15 px-2.5 py-1 text-xs font-medium text-lime-400 transition-all hover:bg-lime-500/25"
            title="Click to unapprove"
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
        ) : isRejected ? (
          <button
            onClick={() => unrejectHunk(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-400 transition-all hover:bg-rose-500/25"
            title="Click to clear rejection"
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
        ) : (
          <div className="flex items-center rounded-md border border-stone-700/50 overflow-hidden">
            <button
              onClick={() => rejectHunk(hunk.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-stone-400 transition-all hover:bg-rose-500/15 hover:text-rose-400"
              title="Reject this change (⌘X)"
              aria-label="Reject change"
            >
              <span>Reject</span>
              <kbd className="hidden sm:inline-block rounded bg-stone-800/80 px-1 py-0.5 text-[0.6rem] font-mono text-stone-500">
                ⌘X
              </kbd>
            </button>
            <div className="w-px self-stretch bg-stone-700/50" />
            <button
              onClick={() => approveHunk(hunk.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-stone-300 transition-all hover:bg-lime-500/15 hover:text-lime-400"
              title="Approve this change (⌘Y)"
              aria-label="Approve change"
            >
              <span>Approve</span>
              <kbd className="hidden sm:inline-block rounded bg-stone-800/80 px-1 py-0.5 text-[0.6rem] font-mono text-stone-500">
                ⌘Y
              </kbd>
            </button>
          </div>
        )}

        {/* Overflow menu - pushed to far right */}
        <div className="ml-auto">
          <OverflowMenu>
            <button
              onClick={() => {
                // Find first changed line to add comment at
                const firstChanged = hunk.lines.find(
                  (l) => l.type === "added" || l.type === "removed",
                );
                const lineNumber = isSource
                  ? (firstChanged?.oldLineNumber ?? hunk.oldStart)
                  : (firstChanged?.newLineNumber ?? hunk.newStart);
                setNewAnnotationLine({
                  lineNumber,
                  side: isSource ? "old" : "new",
                  hunkId: hunk.id,
                });
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
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
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Add comment
            </button>
            {onViewInFile && (
              <button
                onClick={() => {
                  // Find first changed line to jump to
                  const firstChanged = hunk.lines.find(
                    (l) => l.type === "added" || l.type === "removed",
                  );
                  const targetLine =
                    firstChanged?.newLineNumber ?? hunk.newStart;
                  onViewInFile(targetLine);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
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
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                View in file
              </button>
            )}
            <button
              onClick={() => handleCopyHunk(hunk)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 transition-colors"
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
              Copy hunk
            </button>
          </OverflowMenu>
        </div>
      </div>
    );
  };

  // Create file contents for MultiFileDiff when available
  // Use != null to catch both null and undefined (Rust None serializes to null)
  const lang = detectLanguage(fileName, newContent || oldContent);
  const hasFileContents = oldContent != null && newContent != null;

  const oldFile: FileContents | undefined = hasFileContents
    ? { name: fileName, contents: oldContent, lang }
    : undefined;
  const newFile: FileContents | undefined = hasFileContents
    ? { name: fileName, contents: newContent, lang }
    : undefined;

  const diffOptions = {
    diffStyle: viewMode,
    theme: {
      dark: theme,
      light: theme,
    },
    themeType: "dark" as const,
    diffIndicators: "bars" as const,
    disableBackground: false,
    enableHoverUtility: true,
    unsafeCSS: fontSizeCSS,
    expandUnchanged: false,
    expansionLineCount: 20,
    hunkSeparators: "line-info" as const,
  };

  const renderHoverUtility = (
    getHoveredLine: () =>
      | { lineNumber: number; side: "additions" | "deletions" }
      | undefined,
  ) => {
    const hoveredLine = getHoveredLine();
    if (!hoveredLine) return null;

    return (
      <button
        className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/80 text-white shadow-lg transition-all hover:bg-sky-500 hover:scale-110"
        onClick={() => {
          setNewAnnotationLine({
            lineNumber: hoveredLine.lineNumber,
            side: hoveredLine.side === "additions" ? "new" : "old",
            hunkId: "hover",
          });
        }}
        title="Add comment"
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
    );
  };

  return (
    <div className="diff-container">
      <DiffErrorBoundary
        fallback={
          <div className="p-6">
            <div className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 p-4">
              <p className="text-rose-400">Failed to render diff view</p>
            </div>
            <div className="rounded-lg bg-stone-800/30 p-4">
              <p className="mb-2 text-sm text-stone-500">Raw patch:</p>
              <pre className="overflow-auto font-mono text-xs text-stone-300 leading-relaxed">
                {diffPatch}
              </pre>
            </div>
          </div>
        }
      >
        {hasFileContents && oldFile && newFile ? (
          <MultiFileDiff
            oldFile={oldFile}
            newFile={newFile}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            renderHoverUtility={renderHoverUtility}
            options={diffOptions}
          />
        ) : (
          <PatchDiff
            patch={diffPatch}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            renderHoverUtility={renderHoverUtility}
            options={diffOptions}
          />
        )}
      </DiffErrorBoundary>
    </div>
  );
}
