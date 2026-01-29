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
import { SimpleTooltip } from "../../components/ui/tooltip";
import {
  NewAnnotationEditor,
  UserAnnotationDisplay,
  HunkAnnotationPanel,
} from "./annotations";
import type { SupportedLanguages } from "./languageMap";

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
  /** Language override for syntax highlighting */
  language?: SupportedLanguages;
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
  language,
}: DiffViewProps) {
  const reviewState = useReviewStore((s) => s.reviewState);
  const approveHunk = useReviewStore((s) => s.approveHunk);
  const unapproveHunk = useReviewStore((s) => s.unapproveHunk);
  const rejectHunk = useReviewStore((s) => s.rejectHunk);
  const unrejectHunk = useReviewStore((s) => s.unrejectHunk);
  const allHunks = useReviewStore((s) => s.hunks);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);
  const addAnnotation = useReviewStore((s) => s.addAnnotation);
  const updateAnnotation = useReviewStore((s) => s.updateAnnotation);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);
  const classifyingHunkIds = useReviewStore((s) => s.classifyingHunkIds);
  const addTrustPattern = useReviewStore((s) => s.addTrustPattern);
  const removeTrustPattern = useReviewStore((s) => s.removeTrustPattern);
  const reclassifyHunks = useReviewStore((s) => s.reclassifyHunks);
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);
  const prefLineDiffType = useReviewStore((s) => s.diffLineDiffType);
  const prefDiffIndicators = useReviewStore((s) => s.diffIndicators);

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
  // Include "file" annotations as well - they map to the "additions" side (new/compare version)
  const userAnnotations: DiffLineAnnotation<AnnotationMeta>[] =
    fileAnnotations.map((annotation) => ({
      side:
        annotation.side === "old"
          ? ("deletions" as const)
          : ("additions" as const), // "new" and "file" both map to additions
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

    switch (meta.type) {
      case "new":
        return (
          <NewAnnotationEditor
            onSave={handleSaveNewAnnotation}
            onCancel={() => setNewAnnotationLine(null)}
          />
        );

      case "user": {
        const { annotation: userAnnotation } = meta.data;
        return (
          <UserAnnotationDisplay
            annotation={userAnnotation}
            isEditing={editingAnnotationId === userAnnotation.id}
            onEdit={() => setEditingAnnotationId(userAnnotation.id)}
            onSave={(content) => {
              updateAnnotation(userAnnotation.id, content);
              setEditingAnnotationId(null);
            }}
            onCancel={() => setEditingAnnotationId(null)}
            onDelete={() => {
              deleteAnnotation(userAnnotation.id);
              setEditingAnnotationId(null);
            }}
          />
        );
      }

      case "hunk": {
        const { hunk, hunkState, pairedHunk, isSource } = meta.data;
        return (
          <HunkAnnotationPanel
            hunk={hunk}
            hunkState={hunkState}
            pairedHunk={pairedHunk}
            isSource={isSource}
            focusedHunkId={focusedHunkId}
            focusedHunkRef={focusedHunkRef}
            trustList={reviewState?.trustList ?? []}
            classifyingHunkIds={classifyingHunkIds}
            claudeAvailable={claudeAvailable}
            onApprove={approveHunk}
            onUnapprove={unapproveHunk}
            onReject={rejectHunk}
            onUnreject={unrejectHunk}
            onJumpToPair={handleJumpToPair}
            onComment={(lineNumber, side, hunkId) =>
              setNewAnnotationLine({ lineNumber, side, hunkId })
            }
            onAddTrustPattern={addTrustPattern}
            onRemoveTrustPattern={removeTrustPattern}
            onReclassifyHunks={reclassifyHunks}
            onCopyHunk={handleCopyHunk}
            onViewInFile={onViewInFile}
          />
        );
      }
    }
  };

  // Create file contents for MultiFileDiff when available
  // Use != null to catch both null and undefined (Rust None serializes to null)
  // For new files, oldContent is null but we can use empty string
  // For deleted files, newContent is null but we can use empty string
  const hasFileContents = oldContent != null || newContent != null;

  const oldFile: FileContents | undefined = hasFileContents
    ? { name: fileName, contents: oldContent ?? "", lang: language }
    : undefined;
  const newFile: FileContents | undefined = hasFileContents
    ? { name: fileName, contents: newContent ?? "", lang: language }
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
  // Otherwise use the user's preference
  const lineDiffType =
    isLockFile || isLargeFile || (isJsonFile && totalLines > 1000)
      ? "none"
      : prefLineDiffType;

  const diffOptions = {
    diffStyle: viewMode,
    theme: {
      dark: theme,
      light: theme,
    },
    themeType: "dark" as const,
    diffIndicators: prefDiffIndicators,
    disableBackground: false,
    enableHoverUtility: true,
    unsafeCSS: fontSizeCSS,
    expandUnchanged: false,
    expansionLineCount: 20,
    hunkSeparators: "line-info" as const,
    // Performance optimizations
    tokenizeMaxLineLength: 1000, // Skip syntax highlighting for very long lines
    maxLineDiffLength: 500, // Skip word-level diff for long lines
    lineDiffType, // Adaptive based on file type/size, user preference as default
  };

  const renderHoverUtility = (
    getHoveredLine: () =>
      | { lineNumber: number; side: "additions" | "deletions" }
      | undefined,
  ) => {
    const hoveredLine = getHoveredLine();
    if (!hoveredLine) return null;

    return (
      <SimpleTooltip content="Add comment">
        <button
          className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/80 text-white shadow-lg transition-all hover:bg-sky-500 hover:scale-110"
          onClick={() => {
            setNewAnnotationLine({
              lineNumber: hoveredLine.lineNumber,
              side: hoveredLine.side === "additions" ? "new" : "old",
              hunkId: "hover",
            });
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
