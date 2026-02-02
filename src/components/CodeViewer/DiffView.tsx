import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  Component,
  ReactNode,
} from "react";
import { PatchDiff, MultiFileDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileContents } from "@pierre/diffs/react";
import { useReviewStore } from "../../stores";
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

/** Returns true if a hunk contains only deletions (source of a move). */
function isDeletionOnly(hunk: DiffHunk): boolean {
  return (
    hunk.lines.every((l) => l.type === "removed" || l.type === "context") &&
    hunk.lines.some((l) => l.type === "removed")
  );
}

/**
 * Returns the first changed line in a hunk with its side and line number.
 * Used to position comment editors when rejecting or commenting on a hunk.
 */
function getFirstChangedLine(hunk: DiffHunk): {
  lineNumber: number;
  side: "old" | "new";
} {
  const firstChanged = hunk.lines.find(
    (l) => l.type === "added" || l.type === "removed",
  );
  const side: "old" | "new" = firstChanged?.type === "removed" ? "old" : "new";
  const lineNumber =
    side === "old"
      ? (firstChanged?.oldLineNumber ?? hunk.oldStart)
      : (firstChanged?.newLineNumber ?? hunk.newStart);
  return { lineNumber, side };
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

// Detects when @pierre/diffs finishes syntax highlighting by polling
// for styled <span> elements inside the shadow DOM of the diffs-container
// custom element. We poll because the shadow root is not observable via
// MutationObserver from an ancestor outside the shadow boundary.
function useSyntaxHighlightReady(
  containerRef: React.RefObject<HTMLDivElement | null>,
  contentKey: string,
) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const el = containerRef.current;
    if (!el) return;

    const isHighlighted = () => {
      const shadow = el.querySelector("diffs-container")?.shadowRoot;
      if (!shadow) return false;
      const code = shadow.querySelector("code");
      return code ? code.querySelector('span[style*="color"]') !== null : false;
    };

    if (isHighlighted()) {
      setReady(true);
      return;
    }

    const interval = setInterval(() => {
      if (isHighlighted()) {
        setReady(true);
        clearInterval(interval);
      }
    }, 150);

    // Force ready after 5s to prevent infinite shimmer if highlighting never completes
    const timeout = setTimeout(() => {
      setReady(true);
      clearInterval(interval);
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [contentKey]);

  return ready;
}

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
  const pendingCommentHunkId = useReviewStore((s) => s.pendingCommentHunkId);
  const setPendingCommentHunkId = useReviewStore(
    (s) => s.setPendingCommentHunkId,
  );
  const nextHunkInFile = useReviewStore((s) => s.nextHunkInFile);

  // Ref to track focused hunk element for scrolling
  const focusedHunkRef = useRef<HTMLDivElement | null>(null);

  // Track when syntax highlighting finishes
  const diffContainerRef = useRef<HTMLDivElement | null>(null);
  const highlightReady = useSyntaxHighlightReady(diffContainerRef, fileName);

  // Scroll to focused hunk when it changes (skip if triggered by scroll tracking)
  useEffect(() => {
    if (focusedHunkId && focusedHunkRef.current) {
      const { scrollDrivenNavigation } = useReviewStore.getState();
      if (scrollDrivenNavigation) {
        useReviewStore.setState({ scrollDrivenNavigation: false });
        return;
      }
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
    endLineNumber?: number;
    side: "old" | "new";
    hunkId: string;
  } | null>(null);

  // Watch for pending comment requests (from keyboard reject)
  useEffect(() => {
    if (!pendingCommentHunkId) return;
    const targetHunk = hunks.find((h) => h.id === pendingCommentHunkId);
    if (!targetHunk) return;
    if (newAnnotationLine) return;

    const { lineNumber, side } = getFirstChangedLine(targetHunk);
    setNewAnnotationLine({ lineNumber, side, hunkId: pendingCommentHunkId });
    setPendingCommentHunkId(null);
  }, [pendingCommentHunkId, hunks, newAnnotationLine, setPendingCommentHunkId]);

  const filePath = hunks[0]?.filePath ?? "";

  const fileAnnotations = useMemo(() => {
    const all = reviewState?.annotations ?? [];
    return all.filter((a) => a.filePath === filePath);
  }, [reviewState?.annotations, filePath]);

  const hunkStates = reviewState?.hunks;

  // Build line annotations for each hunk - position at last changed line
  // Memoized to preserve reference stability — @pierre/diffs uses reference
  // equality on lineAnnotations to decide whether to re-render the diff.
  const hunkAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(
    () =>
      hunks.map((hunk) => {
        const hunkState = hunkStates?.[hunk.id];
        const pairedHunk = hunk.movePairId
          ? (allHunks.find((h) => h.id === hunk.movePairId) ?? null)
          : null;
        const isSource = pairedHunk ? isDeletionOnly(hunk) : false;

        const changedLines = hunk.lines.filter(
          (l) => l.type === "added" || l.type === "removed",
        );
        const lastChanged = changedLines[changedLines.length - 1];

        let annotationSide: "additions" | "deletions";
        let lineNumber: number;

        if (!lastChanged) {
          annotationSide = isSource ? "deletions" : "additions";
          lineNumber = isSource ? hunk.oldStart : hunk.newStart;
        } else if (lastChanged.type === "removed") {
          annotationSide = "deletions";
          lineNumber = lastChanged.oldLineNumber ?? hunk.oldStart;
        } else {
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
      }),
    [hunks, hunkStates, allHunks],
  );

  // Build annotations for user comments
  // Include "file" annotations as well - they map to the "additions" side (new/compare version)
  const userAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(
    () =>
      fileAnnotations.map((annotation) => ({
        side:
          annotation.side === "old"
            ? ("deletions" as const)
            : ("additions" as const),
        lineNumber: annotation.endLineNumber ?? annotation.lineNumber,
        metadata: { type: "user" as const, data: { annotation } },
      })),
    [fileAnnotations],
  );

  // Combine all annotations into a stable reference
  const lineAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(
    () => [
      ...hunkAnnotations,
      ...userAnnotations,
      ...(newAnnotationLine
        ? [
            {
              side:
                newAnnotationLine.side === "old"
                  ? ("deletions" as const)
                  : ("additions" as const),
              lineNumber:
                newAnnotationLine.endLineNumber ?? newAnnotationLine.lineNumber,
              metadata: { type: "new" as const, data: {} },
            } satisfies DiffLineAnnotation<AnnotationMeta>,
          ]
        : []),
    ],
    [hunkAnnotations, userAnnotations, newAnnotationLine],
  );

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
      newAnnotationLine.endLineNumber,
    );
    const commentHunkId = newAnnotationLine.hunkId;
    setNewAnnotationLine(null);
    // Auto-advance if this comment was attached to a rejected hunk
    // (skip for hover/selection comments which aren't hunk-specific)
    const isHunkComment =
      commentHunkId !== "hover" && commentHunkId !== "selection";
    if (
      isHunkComment &&
      reviewState?.hunks[commentHunkId]?.status === "rejected"
    ) {
      nextHunkInFile();
    }
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
            onApprove={(hunkId) => {
              approveHunk(hunkId);
              nextHunkInFile();
            }}
            onUnapprove={unapproveHunk}
            onReject={(hunkId) => {
              rejectHunk(hunkId);
              const targetHunk = hunks.find((h) => h.id === hunkId);
              if (targetHunk && !newAnnotationLine) {
                const { lineNumber, side } = getFirstChangedLine(targetHunk);
                setNewAnnotationLine({ lineNumber, side, hunkId });
              }
            }}
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

  const oldFile = useMemo<FileContents | undefined>(
    () =>
      hasFileContents
        ? {
            name: fileName,
            contents: oldContent ?? "",
            lang: language,
            cacheKey: `old:${fileName}:${(oldContent ?? "").length}`,
          }
        : undefined,
    [hasFileContents, fileName, oldContent, language],
  );
  const newFile = useMemo<FileContents | undefined>(
    () =>
      hasFileContents
        ? {
            name: fileName,
            contents: newContent ?? "",
            lang: language,
            cacheKey: `new:${fileName}:${(newContent ?? "").length}`,
          }
        : undefined,
    [hasFileContents, fileName, newContent, language],
  );

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
  // Count newlines without allocating split arrays
  const totalLines = useMemo(() => {
    const countLines = (s: string | undefined) => {
      if (!s) return 0;
      let count = 1;
      let idx = -1;
      while ((idx = s.indexOf("\n", idx + 1)) !== -1) count++;
      return count;
    };
    return countLines(oldContent) + countLines(newContent);
  }, [oldContent, newContent]);
  const isLargeFile = totalLines > 5000;

  // For lock files and very large files, disable word-level diffing entirely
  // For large JSON files, also disable to improve performance
  // Otherwise use the user's preference
  const lineDiffType =
    isLockFile || isLargeFile || (isJsonFile && totalLines > 1000)
      ? "none"
      : prefLineDiffType;

  // Generate CSS to subtly highlight lines covered by annotations.
  // Injected into the shadow DOM via unsafeCSS so annotated line ranges
  // stay visually connected to the comment rendered below them.
  const annotationHighlightCSS = useMemo(() => {
    if (fileAnnotations.length === 0) return "";
    const lineSelectors: string[] = [];
    for (const a of fileAnnotations) {
      const end = a.endLineNumber ?? a.lineNumber;
      for (let line = a.lineNumber; line <= end; line++) {
        lineSelectors.push(`[data-line="${line}"]`);
      }
    }
    if (lineSelectors.length === 0) return "";
    const selector = [...new Set(lineSelectors)].join(", ");
    return `
      :is(${selector}) > [data-column-content] {
        background-image: linear-gradient(to right, rgba(245, 158, 11, 0.07), rgba(245, 158, 11, 0.03)) !important;
      }
      :is(${selector}) > [data-column-number]:last-of-type {
        box-shadow: inset -2px 0 0 rgba(245, 158, 11, 0.35);
      }
    `;
  }, [fileAnnotations]);

  // Track line selection for range commenting.
  // Use onLineSelectionEnd (fires on pointerup) instead of onLineSelected
  // (fires on every drag move) to avoid mid-drag re-renders that disrupt
  // the selection. Only open the annotation editor for multi-line ranges —
  // single-line comments are handled by the hover "+" button.
  const handleLineSelectionEnd = useCallback(
    (range: { start: number; end: number; side?: string } | null) => {
      if (!range) return;
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      if (start === end) return; // single line — use hover button instead
      const side: "old" | "new" = range.side === "deletions" ? "old" : "new";
      setNewAnnotationLine({
        lineNumber: start,
        endLineNumber: end,
        side,
        hunkId: "selection",
      });
    },
    [],
  );

  const diffOptions = useMemo(
    () => ({
      diffStyle: viewMode,
      theme: {
        dark: theme,
        light: theme,
      },
      themeType: "dark" as const,
      diffIndicators: prefDiffIndicators,
      disableBackground: false,
      enableHoverUtility: true,
      enableLineSelection: true,
      onLineSelectionEnd: handleLineSelectionEnd,
      unsafeCSS: fontSizeCSS + annotationHighlightCSS,
      expandUnchanged: true,
      expansionLineCount: 20,
      hunkSeparators: "line-info" as const,
      // Performance optimizations
      tokenizeMaxLineLength: 1000, // Skip syntax highlighting for very long lines
      maxLineDiffLength: 500, // Skip word-level diff for long lines
      lineDiffType, // Adaptive based on file type/size, user preference as default
    }),
    [
      viewMode,
      theme,
      prefDiffIndicators,
      fontSizeCSS,
      annotationHighlightCSS,
      lineDiffType,
      handleLineSelectionEnd,
    ],
  );

  const renderHoverUtility = (
    getHoveredLine: () =>
      | { lineNumber: number; side: "additions" | "deletions" }
      | undefined,
  ) => {
    // Always render the button — the shadow DOM controls visibility by
    // moving the slot container to the hovered line. Call getHoveredLine()
    // at click time (not render time) to get the current line.
    return (
      <SimpleTooltip content="Add comment">
        <button
          className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/80 text-white shadow-lg transition-all hover:bg-sky-500 hover:scale-110"
          onClick={() => {
            const hoveredLine = getHoveredLine();
            if (!hoveredLine) return;
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
    <div className="diff-container relative" ref={diffContainerRef}>
      {!highlightReady && (
        <div className="absolute top-0 left-0 right-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-[shimmer_1s_ease-in-out_infinite] bg-sky-500/50 rounded-full" />
        </div>
      )}
      <DiffErrorBoundary
        key={fileName}
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
