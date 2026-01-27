import {
  useState,
  useMemo,
  useEffect,
  useRef,
  Component,
  ReactNode,
} from "react";
import { PatchDiff, MultiFileDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileContents } from "@pierre/diffs/react";
import { useReviewStore } from "../../stores/reviewStore";
import { getPlatformServices } from "../../platform";
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
  // Focused hunk for keyboard navigation
  focusedHunkId?: string | null;
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
  focusedHunkId,
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
    addTrustPattern,
    removeTrustPattern,
    reclassifyHunks,
    claudeAvailable,
  } = useReviewStore();

  // Ref to track focused hunk element for scrolling
  const focusedHunkRef = useRef<HTMLDivElement | null>(null);

  // Scroll to focused hunk when it changes
  useEffect(() => {
    if (focusedHunkId && focusedHunkRef.current) {
      focusedHunkRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [focusedHunkId]);

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

  // Build line annotations for each hunk - position at last changed line
  const hunkAnnotations: DiffLineAnnotation<AnnotationMeta>[] = hunks.map(
    (hunk) => {
      const hunkState = reviewState?.hunks[hunk.id];
      const pairedHunk = hunk.movePairId
        ? (allHunks.find((h) => h.id === hunk.movePairId) ?? null)
        : null;
      const isSource = pairedHunk ? isDeletionOnly(hunk) : false;

      // Find the last changed line to position annotation after it
      const changedLines = hunk.lines.filter(
        (l) => l.type === "added" || l.type === "removed",
      );
      const lastChanged = changedLines[changedLines.length - 1];

      // Determine side and line number based on the last change type
      // For deletions: use deletions side with oldLineNumber
      // For additions: use additions side with newLineNumber
      // This ensures the annotation appears right at the last change
      let annotationSide: "additions" | "deletions";
      let lineNumber: number;

      if (!lastChanged) {
        // No changes (shouldn't happen), fall back to defaults
        annotationSide = isSource ? "deletions" : "additions";
        lineNumber = isSource ? hunk.oldStart : hunk.newStart;
      } else if (lastChanged.type === "removed") {
        // Last change is a deletion - put annotation on deletions side
        annotationSide = "deletions";
        lineNumber = lastChanged.oldLineNumber ?? hunk.oldStart;
      } else {
        // Last change is an addition - put annotation on additions side
        annotationSide = "additions";
        lineNumber = lastChanged.newLineNumber ?? hunk.newStart;
      }

      return {
        side: annotationSide,
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
    const platform = getPlatformServices();
    await platform.clipboard.writeText(hunk.content);
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
    const isFocused = hunk.id === focusedHunkId;

    return (
      <div
        ref={isFocused ? focusedHunkRef : undefined}
        className={`flex items-center gap-2 px-3 py-1.5 border-t border-stone-700/50 ${
          isFocused ? "ring-2 ring-inset ring-amber-500/70" : ""
        } ${
          isRejected
            ? "bg-rose-500/10"
            : isApproved
              ? "bg-lime-500/5"
              : isTrusted
                ? "bg-sky-500/5"
                : "bg-stone-800/80"
        }`}
      >
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
            className="group flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400 transition-all hover:bg-emerald-500/30 ring-1 ring-inset ring-emerald-500/30"
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
            className="group flex items-center gap-1.5 rounded-md bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-400 transition-all hover:bg-rose-500/30 ring-1 ring-inset ring-rose-500/30"
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
          <div className="flex items-center gap-1">
            <button
              onClick={() => rejectHunk(hunk.id)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-rose-400/70 bg-rose-500/10 transition-all hover:bg-rose-500/20 hover:text-rose-400"
              title="Reject this change (r)"
              aria-label="Reject change"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span>Reject</span>
              {isFocused && <kbd className="ml-0.5 text-xxs opacity-60">r</kbd>}
            </button>
            <button
              onClick={() => approveHunk(hunk.id)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-emerald-400/70 bg-emerald-500/10 transition-all hover:bg-emerald-500/20 hover:text-emerald-400"
              title="Approve this change (a)"
              aria-label="Approve change"
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Approve</span>
              {isFocused && <kbd className="ml-0.5 text-xxs opacity-60">a</kbd>}
            </button>
          </div>
        )}

        {/* Comment button - inline after approve/reject */}
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
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-stone-500 transition-all hover:bg-stone-700/50 hover:text-stone-300"
          title="Add comment"
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
              d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
            />
          </svg>
          <span className="hidden sm:inline">Comment</span>
        </button>

        {/* Right side: classifying indicator, trust labels, reasoning, overflow menu */}
        <div className="ml-auto flex items-center gap-2">
          {/* Classifying indicator - fixed width container to prevent layout shift */}
          <div className="w-[5.5rem] flex justify-end">
            {classifyingHunkIds.has(hunk.id) && (
              <div className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5">
                <svg
                  className="h-3 w-3 animate-spin text-violet-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
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
          </div>

          {/* Trust labels - click to toggle trust */}
          {hunkState?.label && hunkState.label.length > 0 && (
            <div className="flex items-center gap-1.5">
              <svg
                className="h-3 w-3 text-stone-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              {hunkState.label.map((lbl, i) => {
                const isTrustedLabel = (reviewState?.trustList ?? []).includes(
                  lbl,
                );
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (isTrustedLabel) {
                        removeTrustPattern(lbl);
                      } else {
                        addTrustPattern(lbl);
                      }
                    }}
                    className={`rounded px-1.5 py-0.5 text-xxs font-medium cursor-pointer transition-all hover:ring-1 ${
                      isTrustedLabel
                        ? "bg-sky-500/15 text-sky-400 hover:ring-sky-400/50"
                        : "bg-stone-700/50 text-stone-400 hover:ring-stone-400/50"
                    }`}
                    title={`${isTrustedLabel ? "Click to untrust" : "Click to trust"} "${lbl}"`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          )}

          {/* Reasoning indicator - shows when reasoning exists */}
          {hunkState?.reasoning && (
            <span
              className="text-stone-600 hover:text-stone-400 cursor-help transition-colors"
              title={hunkState.reasoning}
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
                />
              </svg>
            </span>
          )}

          {/* Overflow menu */}
          <div>
            <OverflowMenu>
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
              {claudeAvailable && (
                <button
                  onClick={() => reclassifyHunks([hunk.id])}
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
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                  Reclassify
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

  // Performance optimization: detect large files and JSON files
  // JSON diffs are often noisy with word-level diffing; large files are slow to render
  const isJsonFile = fileName.endsWith(".json");
  const isLockFile =
    fileName.endsWith("package-lock.json") ||
    fileName.endsWith("yarn.lock") ||
    fileName.endsWith("pnpm-lock.yaml") ||
    fileName.endsWith("Cargo.lock") ||
    fileName.endsWith("Gemfile.lock") ||
    fileName.endsWith("composer.lock");
  const totalLines =
    (oldContent?.split("\n").length ?? 0) +
    (newContent?.split("\n").length ?? 0);
  const isLargeFile = totalLines > 5000;

  // For lock files and very large files, disable word-level diffing entirely
  // For large JSON files, also disable to improve performance
  const lineDiffType: "word" | "none" =
    isLockFile || isLargeFile || (isJsonFile && totalLines > 1000)
      ? "none"
      : "word";

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
    // Performance optimizations
    tokenizeMaxLineLength: 1000, // Skip syntax highlighting for very long lines
    maxLineDiffLength: 500, // Skip word-level diff for long lines
    lineDiffType, // Adaptive based on file type/size
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
