import {
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { CodeView } from "@pierre/diffs/react";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  parseDiffFromFile,
  getSingularPatch,
  setLanguageOverride,
} from "@pierre/diffs";
import type {
  CodeViewItem,
  CodeViewLineSelection,
  CodeViewScrollBehavior,
  DiffLineAnnotation,
  FileDiffMetadata,
  LineAnnotation as PierreLineAnnotation,
  SelectionSide,
} from "@pierre/diffs";
import type { CodeViewOptions } from "@pierre/diffs";
import { useReviewStore } from "../../stores";
import { stringHash } from "../../utils/string-hash";
import type { DiffHunk, LineAnnotation } from "../../types";
import type { SupportedLanguages } from "./languageMap";
import { DiffErrorBoundary } from "./DiffView";
import {
  AnnotationEditor,
  AnnotationDisplay,
} from "./annotations/AnnotationEditor";
import {
  useDiffAnnotationModel,
  useAdaptiveLineDiffType,
  useSyntaxHighlightReady,
  isValidLineNumber,
  type AnnotationMeta,
  type TokenHoverHandler,
  type TokenClickHandler,
} from "./diff-model";

export interface FileCodeViewHandle {
  /** Scroll a line into view — CodeView computes the exact offset, no polling. */
  scrollToLine(
    lineNumber: number,
    opts?: { side?: SelectionSide; behavior?: CodeViewScrollBehavior },
  ): void;
}

export type FileCodeViewContent =
  | {
      kind: "diff";
      diffPatch: string;
      hunks: DiffHunk[];
      oldContent?: string;
      newContent?: string;
      viewMode: "unified" | "split";
      expandUnchanged: boolean;
    }
  | {
      kind: "plain";
      content: string;
      /** Extra shadow-DOM CSS (e.g. old/new view mode diff line highlights) */
      extraCSS?: string;
    };

interface FileCodeViewProps {
  filePath: string;
  content: FileCodeViewContent;
  theme: string;
  fontCSS: string;
  language?: SupportedLanguages;
  lineHeight: number;
  highlightLine?: number | null;
  onViewInFile?: (line: number) => void;
  onTokenEnter?: TokenHoverHandler;
  onTokenLeave?: TokenHoverHandler;
  onTokenClick?: TokenClickHandler;
  /** Receives the scroll container element (CodeView owns scrolling) */
  containerRef?: (node: HTMLDivElement | null) => void;
  /** Imperative scroll API */
  handleRef?: React.Ref<FileCodeViewHandle>;
}

/**
 * Single-file code surface built on pierre's CodeView. Renders exactly one
 * item (a diff or a plain file) and owns the scroll container, virtualization
 * and programmatic scrolling. Replaces the Virtualizer + MultiFileDiff /
 * File arrangement and the approximate-scroll/poll workaround it required.
 */
export function FileCodeView({
  filePath,
  content,
  theme,
  fontCSS,
  language,
  lineHeight,
  highlightLine,
  onViewInFile,
  onTokenEnter,
  onTokenLeave,
  onTokenClick,
  containerRef,
  handleRef,
}: FileCodeViewProps): ReactNode {
  const diffOverflow = useReviewStore((s) => s.diffOverflow);

  const isDiff = content.kind === "diff";
  const hunks = isDiff ? content.hunks : EMPTY_HUNKS;
  const itemId = isDiff ? `diff:${filePath}` : `file:${filePath}`;

  // --- Diff annotation model (hunk panels, comments, selection/gutter) ---
  const diffModel = useDiffAnnotationModel({
    hunks,
    filePath,
    fileName: filePath,
    onViewInFile,
  });

  // --- Plain-file annotation model (side === "file" comments) ---
  const plainModel = usePlainAnnotationModel(filePath);

  // --- Item payload ---
  const oldContent = isDiff ? content.oldContent : undefined;
  const newContent = isDiff ? content.newContent : undefined;
  const diffPatch = isDiff ? content.diffPatch : "";
  const oldContentHash = useMemo(
    () => stringHash(oldContent ?? ""),
    [oldContent],
  );
  const newContentHash = useMemo(
    () => stringHash(newContent ?? ""),
    [newContent],
  );

  const fileDiff = useMemo<FileDiffMetadata | null>(() => {
    if (!isDiff) return null;
    // Use full contents when available (enables hunk expansion); fall back
    // to the patch for content we couldn't load (e.g. very large files).
    const hasFileContents = oldContent != null || newContent != null;
    const parsed = hasFileContents
      ? parseDiffFromFile(
          {
            name: filePath,
            contents: oldContent ?? "",
            lang: language,
            cacheKey: `old:${filePath}:${oldContentHash}`,
          },
          {
            name: filePath,
            contents: newContent ?? "",
            lang: language,
            cacheKey: `new:${filePath}:${newContentHash}`,
          },
        )
      : getSingularPatch(diffPatch);
    return language ? setLanguageOverride(parsed, language) : parsed;
    // Hashes stand in for the content strings themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDiff, filePath, oldContentHash, newContentHash, diffPatch, language]);

  const plainContent = !isDiff ? content.content : "";
  const plainFile = useMemo(
    () =>
      isDiff
        ? null
        : {
            name: filePath,
            contents: plainContent,
            lang: language,
            cacheKey: `file:${filePath}:${stringHash(plainContent)}`,
          },
    [isDiff, filePath, plainContent, language],
  );

  // Controlled items: CodeView only re-reads an item (and re-invokes its
  // annotation renderers) when its version changes, so bump it whenever the
  // payload, the annotations, or any state the renderers read changes.
  const annotations = isDiff
    ? diffModel.lineAnnotations
    : plainModel.lineAnnotations;
  const renderRevision = isDiff
    ? diffModel.renderRevision
    : plainModel.renderRevision;
  const versionRef = useRef(0);
  // renderRevision is deps-only: it forces a version bump for state the
  // annotation renderers read through their deps refs.
  const items = useMemo<CodeViewItem<AnnotationMeta>[]>(() => {
    versionRef.current += 1;
    if (fileDiff) {
      return [
        {
          id: itemId,
          type: "diff",
          fileDiff,
          annotations: annotations as DiffLineAnnotation<AnnotationMeta>[],
          version: versionRef.current,
        },
      ];
    }
    if (plainFile) {
      return [
        {
          id: itemId,
          type: "file",
          file: plainFile,
          annotations: annotations as PierreLineAnnotation<AnnotationMeta>[],
          version: versionRef.current,
        },
      ];
    }
    return [];
  }, [itemId, fileDiff, plainFile, annotations, renderRevision]);

  const renderAnnotation = useCallback(
    (
      annotation:
        | PierreLineAnnotation<AnnotationMeta>
        | DiffLineAnnotation<AnnotationMeta>,
      item: CodeViewItem<AnnotationMeta>,
    ): ReactNode => {
      if (item.type === "diff") {
        return diffModel.renderAnnotation(
          annotation as DiffLineAnnotation<AnnotationMeta>,
        );
      }
      return plainModel.renderAnnotation(annotation);
    },
    [diffModel.renderAnnotation, plainModel.renderAnnotation],
  );

  const handleGutterUtilityClick = useCallback(
    (range: { start: number; end: number; side?: string }) => {
      if (isDiff) {
        diffModel.handleGutterUtilityClick(range);
      } else {
        plainModel.handleGutterUtilityClick(range);
      }
    },
    [
      isDiff,
      diffModel.handleGutterUtilityClick,
      plainModel.handleGutterUtilityClick,
    ],
  );

  const lineDiffType = useAdaptiveLineDiffType(
    filePath,
    oldContent,
    newContent,
  );

  const extraCSS = isDiff
    ? diffModel.annotationHighlightCSS
    : (content.extraCSS ?? "");

  const options = useMemo<CodeViewOptions<AnnotationMeta>>(
    () => ({
      diffStyle: isDiff ? content.viewMode : "unified",
      theme: { dark: theme, light: theme },
      themeType: "dark",
      diffIndicators: "none",
      disableBackground: false,
      // FileViewerToolbar already shows the filename and review actions —
      // suppress pierre's default per-file header to avoid duplication.
      disableFileHeader: true,
      enableGutterUtility: true,
      enableLineSelection: isDiff,
      onGutterUtilityClick: handleGutterUtilityClick,
      onLineSelectionEnd: diffModel.handleLineSelectionEnd,
      onTokenEnter,
      onTokenLeave,
      onTokenClick,
      unsafeCSS: fontCSS + extraCSS,
      expandUnchanged: isDiff ? content.expandUnchanged : true,
      expansionLineCount: 20,
      hunkSeparators: "line-info",
      // Performance optimizations
      tokenizeMaxLineLength: 1000, // Skip syntax highlighting for very long lines
      maxLineDiffLength: 500, // Skip word-level diff for long lines
      lineDiffType, // Adaptive based on file type/size, user preference as default
      // The wrap preference is a diff-view setting; plain files always scroll
      // (parity with the old PlainCodeView).
      overflow: isDiff ? diffOverflow : "scroll",
      itemMetrics: { lineHeight },
      // Extra scroll room so annotation panels at the end of a file
      // don't clip trailing lines (was pb-16 on the old content wrapper).
      layout: { paddingTop: 0, paddingBottom: 64, gap: 0 },
    }),
    [
      isDiff,
      isDiff ? content.viewMode : null,
      isDiff ? content.expandUnchanged : null,
      theme,
      fontCSS,
      extraCSS,
      lineDiffType,
      diffOverflow,
      lineHeight,
      handleGutterUtilityClick,
      diffModel.handleLineSelectionEnd,
      onTokenEnter,
      onTokenLeave,
      onTokenClick,
    ],
  );

  const selectedLines = useMemo<CodeViewLineSelection | null>(
    () =>
      highlightLine
        ? {
            id: itemId,
            range: {
              start: highlightLine,
              end: highlightLine,
              side: "additions",
            },
          }
        : null,
    [highlightLine, itemId],
  );

  // --- Imperative scroll API ---
  const codeViewRef = useRef<CodeViewHandle<AnnotationMeta>>(null);
  useImperativeHandle(
    handleRef,
    () => ({
      scrollToLine(lineNumber, opts) {
        codeViewRef.current?.scrollTo({
          type: "line",
          id: itemId,
          lineNumber,
          side: opts?.side,
          align: "center",
          behavior: opts?.behavior ?? "smooth-auto",
        });
      },
    }),
    [itemId],
  );

  // --- Syntax highlight shimmer ---
  const shimmerRef = useRef<HTMLDivElement | null>(null);
  const contentKey = isDiff
    ? `${filePath}:${oldContentHash}:${newContentHash}`
    : (plainFile?.cacheKey ?? filePath);
  const highlightReady = useSyntaxHighlightReady(shimmerRef, contentKey);

  const setContainerNode = useCallback(
    (node: HTMLDivElement | null) => {
      shimmerRef.current = node;
      containerRef?.(node);
    },
    [containerRef],
  );

  return (
    <div className="relative min-w-0 flex-1 h-full diff-container">
      {!highlightReady && (
        <div className="absolute top-0 left-0 right-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-[shimmer_1s_ease-in-out_infinite] bg-status-renamed/50 rounded-full" />
        </div>
      )}
      {/* Keyed per file only (parity with the old key={fileName}) — content
          changes flow through the versioned item so CodeView updates in
          place and preserves the scroll anchor instead of remounting. */}
      <DiffErrorBoundary
        key={itemId}
        fallback={
          <div className="p-6">
            <div className="rounded-lg bg-status-rejected/10 border border-status-rejected/20 p-4">
              <p className="text-status-rejected">Failed to render file view</p>
              <p className="mt-1 text-sm text-fg-muted">{filePath}</p>
            </div>
          </div>
        }
      >
        <CodeView<AnnotationMeta>
          ref={codeViewRef}
          items={items}
          options={options}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          containerRef={setContainerNode}
          className={`h-full w-full bg-surface-panel ${
            isDiff ? "scrollbar-none" : "scrollbar-thin"
          }`}
          style={CODE_VIEW_STYLE}
        />
      </DiffErrorBoundary>
    </div>
  );
}

const CODE_VIEW_STYLE = { overflow: "auto" } as const;
const EMPTY_HUNKS: DiffHunk[] = [];

type PlainAnnotationLine = { lineNumber: number; endLineNumber?: number };

/**
 * Annotation model for plain (non-diff) file views: file-side comments,
 * the new-comment editor, and the gutter "+" handler. Equivalent of what
 * PlainCodeView used to wire inline.
 */
function usePlainAnnotationModel(filePath: string) {
  const reviewState = useReviewStore((s) => s.reviewState);
  const [newAnnotationLine, setNewAnnotationLine] =
    useState<PlainAnnotationLine | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(
    null,
  );

  // File-view comments: side === "file", attached to a line (> 0)
  const fileAnnotations = useMemo(() => {
    const all = reviewState?.annotations ?? [];
    return all.filter(
      (a) => a.filePath === filePath && a.side === "file" && a.lineNumber > 0,
    );
  }, [reviewState?.annotations, filePath]);

  const lineAnnotations = useMemo<
    PierreLineAnnotation<AnnotationMeta>[]
  >(() => {
    const items: PierreLineAnnotation<AnnotationMeta>[] = [];
    for (const annotation of fileAnnotations) {
      items.push({
        lineNumber: annotation.endLineNumber ?? annotation.lineNumber,
        metadata: { type: "user", data: { annotation } },
      });
    }
    if (newAnnotationLine !== null) {
      items.push({
        lineNumber:
          newAnnotationLine.endLineNumber ?? newAnnotationLine.lineNumber,
        metadata: { type: "new", data: {} },
      });
    }
    return items;
  }, [fileAnnotations, newAnnotationLine]);

  const depsRef = useRef<{
    filePath: string;
    newAnnotationLine: PlainAnnotationLine | null;
    editingAnnotationId: string | null;
  }>(null!);
  depsRef.current = { filePath, newAnnotationLine, editingAnnotationId };

  const renderAnnotation = useCallback(
    (
      annotation:
        | PierreLineAnnotation<AnnotationMeta>
        | DiffLineAnnotation<AnnotationMeta>,
    ): ReactNode => {
      const deps = depsRef.current;
      const meta = annotation.metadata!;

      if (meta.type === "new") {
        return (
          <AnnotationEditor
            onSave={(content) => {
              const line = deps.newAnnotationLine;
              if (!line) return;
              useReviewStore
                .getState()
                .addAnnotation(
                  deps.filePath,
                  line.lineNumber,
                  "file",
                  content,
                  line.endLineNumber,
                );
              setNewAnnotationLine(null);
            }}
            onCancel={() => setNewAnnotationLine(null)}
            autoFocus
          />
        );
      }

      if (meta.type !== "user") return null;
      const { annotation: userAnnotation } = meta.data;

      if (deps.editingAnnotationId === userAnnotation.id) {
        return (
          <AnnotationEditor
            initialContent={userAnnotation.content}
            onSave={(content) => {
              useReviewStore
                .getState()
                .updateAnnotation(userAnnotation.id, content);
              setEditingAnnotationId(null);
            }}
            onCancel={() => setEditingAnnotationId(null)}
            onDelete={() => {
              useReviewStore.getState().deleteAnnotation(userAnnotation.id);
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
          onDelete={() =>
            useReviewStore.getState().deleteAnnotation(userAnnotation.id)
          }
          onResolve={() =>
            useReviewStore.getState().resolveAnnotation(userAnnotation.id)
          }
          onUnresolve={() =>
            useReviewStore.getState().unresolveAnnotation(userAnnotation.id)
          }
        />
      );
    },
    [],
  );

  const handleGutterUtilityClick = useCallback(
    (range: { start: number; end: number; side?: string }) => {
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      if (!isValidLineNumber(start) || !isValidLineNumber(end)) return;
      setNewAnnotationLine({
        lineNumber: start,
        endLineNumber: start !== end ? end : undefined,
      });
    },
    [],
  );

  const renderRevisionRef = useRef(0);
  const renderRevision = useMemo(
    () => ++renderRevisionRef.current,
    // State the renderer reads through the deps ref that is not already
    // part of lineAnnotations' identity (see DiffAnnotationModel.renderRevision).
    [editingAnnotationId, newAnnotationLine, filePath],
  );

  return {
    lineAnnotations,
    renderAnnotation,
    handleGutterUtilityClick,
    renderRevision,
  };
}

// Re-exported so FileViewer can keep its imports narrow.
export type { LineAnnotation };
