import {
  type ReactNode,
  useCallback,
  useEffect,
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
import { viewOnly } from "../../stores/selectors/ephemeral";
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
import { ShapeGutter } from "./ShapeGutter";
import type { ShapeRow } from "./shape-model";

/**
 * Shape ("outline") reading posture for a plain file: the content handed in is
 * a synthesized document with folded bodies elided, and `rows` says what each
 * of its lines really is. See `shape-model.ts` for why the document is
 * synthesized rather than hidden with CSS.
 */
export interface ShapeViewState {
  rows: ShapeRow[];
  onToggleFold: (foldId: string) => void;
  /**
   * Identifies the synthesized document (file content + which folds are open),
   * so pierre's cache key doesn't have to re-hash the whole document on every
   * fold toggle. Supplied by the shape-mode hook that builds `rows`.
   */
  cacheKey: string;
}

export interface FileCodeViewHandle {
  /** Scroll a line into view — CodeView computes the exact offset, no polling. */
  scrollToLine(
    lineNumber: number,
    opts?: { side?: SelectionSide; behavior?: CodeViewScrollBehavior },
  ): void;
}

/**
 * Cancel CodeView's in-flight spring scroll. It cancels only on input events
 * fired on its own scroll element, so a sibling (the minimap track) that is
 * about to drive scrollTop directly relays a press here first — otherwise the
 * animation rewrites scrollTop every frame and fights it. A plain `Event`
 * (non-bubbling, no pointer fields) reaches CodeView's native listener without
 * re-entering React's delegated handlers.
 */
export function cancelCodeViewScroll(scrollEl: HTMLElement): void {
  scrollEl.dispatchEvent(new Event("pointerdown"));
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
  /**
   * Set while the minimap is up beside this view: it IS the scrollbar, so the
   * native one hides — two bars side by side is noise.
   */
  hideScrollbar?: boolean;
  /** Imperative scroll API */
  handleRef?: React.Ref<FileCodeViewHandle>;
  /**
   * Present only for a plain file being read in shape mode. Turns the surface
   * read-only (no comment gutter, no token hover/click) and swaps pierre's
   * line numbers for the real ones.
   */
  shape?: ShapeViewState;
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
  hideScrollbar,
  handleRef,
  shape,
}: FileCodeViewProps): ReactNode {
  const diffOverflow = useReviewStore((s) => s.diffOverflow);
  // No comment gutter and no comments rendered when the content on screen
  // isn't something a decision can be filed against. Degrade visibly: the
  // affordance is gone, not present-but-broken.
  const readOnly = useReviewStore(viewOnly);

  const isDiff = content.kind === "diff";
  // Only ever set for a plain file — a diff has its own notion of elision.
  const shapeMode = shape !== undefined;
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
  // In shape mode the document is re-synthesized on every fold toggle, and its
  // cacheKey already identifies (file content × open folds) — so take that
  // instead of re-hashing the whole synthesized text per toggle.
  const plainCacheKey = useMemo(
    () => shape?.cacheKey ?? stringHash(plainContent),
    [shape, plainContent],
  );
  const plainFile = useMemo(
    () =>
      isDiff
        ? null
        : {
            name: filePath,
            contents: plainContent,
            lang: language,
            cacheKey: `file:${filePath}:${plainCacheKey}`,
          },
    [isDiff, filePath, plainContent, language, plainCacheKey],
  );

  // Controlled items: CodeView only re-reads an item (and re-invokes its
  // annotation renderers) when its version changes, so bump it whenever the
  // payload, the annotations, or any state the renderers read changes.
  // Shape mode is a reading posture, not an editing surface: comments and
  // their editors stay out of the synthesized document, whose line numbers
  // wouldn't line up with the real file anyway.
  const annotations =
    shapeMode || readOnly
      ? EMPTY_ANNOTATIONS
      : isDiff
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
    // `renderRevision` is an invalidation key, not something the body reads:
    // it bumps when the annotation renderer's inputs change, which is the only
    // way pierre re-runs `renderAnnotation` for items it already holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, fileDiff, plainFile, annotations, renderRevision]);

  // Destructured so the deps below name plain variables: depending on
  // `diffModel.renderAnnotation` is the intent (the model object itself is
  // rebuilt more often than its renderer), but a member expression is
  // something the hooks rule cannot check.
  const { renderAnnotation: renderDiffAnnotation } = diffModel;
  const { renderAnnotation: renderPlainAnnotation } = plainModel;

  const renderAnnotation = useCallback(
    (
      annotation:
        | PierreLineAnnotation<AnnotationMeta>
        | DiffLineAnnotation<AnnotationMeta>,
      item: CodeViewItem<AnnotationMeta>,
    ): ReactNode => {
      if (item.type === "diff") {
        return renderDiffAnnotation(
          annotation as DiffLineAnnotation<AnnotationMeta>,
        );
      }
      return renderPlainAnnotation(annotation);
    },
    [renderDiffAnnotation, renderPlainAnnotation],
  );

  const { handleGutterUtilityClick: diffGutterUtilityClick } = diffModel;
  const { handleGutterUtilityClick: plainGutterUtilityClick } = plainModel;

  const handleGutterUtilityClick = useCallback(
    (range: { start: number; end: number; side?: string }) => {
      if (isDiff) {
        diffGutterUtilityClick(range);
      } else {
        plainGutterUtilityClick(range);
      }
    },
    [isDiff, diffGutterUtilityClick, plainGutterUtilityClick],
  );

  const lineDiffType = useAdaptiveLineDiffType(
    filePath,
    oldContent,
    newContent,
  );

  // --- Shape mode: clicking an elision marker expands that body ---
  // pierre reports the line number of the *synthesized* document, which is
  // exactly the index into `shape.rows`.
  const shapeRef = useRef<ShapeViewState | undefined>(undefined);
  shapeRef.current = shape;
  const handleShapeLineClick = useCallback((props: { lineNumber: number }) => {
    const state = shapeRef.current;
    if (!state) return;
    const row = state.rows[props.lineNumber - 1];
    if (row?.kind === "marker") state.onToggleFold(row.foldId);
  }, []);

  const extraCSS = isDiff
    ? diffModel.annotationHighlightCSS
    : (content.extraCSS ?? "");

  // Hoisted out of the deps array below: a ternary there is something the
  // hooks rule cannot check, and both are read inside the memo.
  const diffStyle = isDiff ? content.viewMode : "unified";
  const expandUnchanged = isDiff ? content.expandUnchanged : true;

  const options = useMemo<CodeViewOptions<AnnotationMeta>>(
    () => ({
      diffStyle,
      theme: { dark: theme, light: theme },
      themeType: "dark",
      diffIndicators: "none",
      disableBackground: false,
      // FileViewerToolbar already shows the filename and review actions —
      // suppress pierre's default per-file header to avoid duplication.
      disableFileHeader: true,
      // Shape mode reads a synthesized document: pierre's 1..N numbering would
      // be wrong, so it is switched off and ShapeGutter draws the real numbers.
      disableLineNumbers: shapeMode,
      enableGutterUtility: !shapeMode && !readOnly,
      enableLineSelection: isDiff,
      onGutterUtilityClick: handleGutterUtilityClick,
      onLineSelectionEnd: diffModel.handleLineSelectionEnd,
      onLineClick: shapeMode ? handleShapeLineClick : undefined,
      lineHoverHighlight: shapeMode ? "line" : undefined,
      onTokenEnter: shapeMode ? undefined : onTokenEnter,
      onTokenLeave: shapeMode ? undefined : onTokenLeave,
      onTokenClick: shapeMode ? undefined : onTokenClick,
      unsafeCSS: fontCSS + extraCSS,
      expandUnchanged,
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
      diffStyle,
      expandUnchanged,
      readOnly,
      shapeMode,
      theme,
      fontCSS,
      extraCSS,
      lineDiffType,
      diffOverflow,
      lineHeight,
      handleGutterUtilityClick,
      handleShapeLineClick,
      diffModel.handleLineSelectionEnd,
      onTokenEnter,
      onTokenLeave,
      onTokenClick,
    ],
  );

  const selectedLines = useMemo<CodeViewLineSelection | null>(
    () =>
      // Line selection is off in shape mode, and `highlightLine` is a real
      // line number that the synthesized document does not share.
      highlightLine && !shapeMode
        ? {
            id: itemId,
            range: {
              start: highlightLine,
              end: highlightLine,
              side: "additions",
            },
          }
        : null,
    [highlightLine, itemId, shapeMode],
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

  // ShapeGutter has to follow pierre's scroll offset, so the container is kept
  // as state (not just a ref) for the one render that hands it over. Only shape
  // mode needs it, so every other file view is spared that extra render.
  // pierre's own container ref is identity-stable and fires only when the node
  // mounts, so switching into shape mode later publishes the captured node.
  const scrollNodeRef = useRef<HTMLDivElement | null>(null);
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);

  const setContainerNode = useCallback(
    (node: HTMLDivElement | null) => {
      shimmerRef.current = node;
      scrollNodeRef.current = node;
      setScrollNode(shapeRef.current ? node : null);
      containerRef?.(node);
    },
    [containerRef],
  );

  useEffect(() => {
    setScrollNode(shapeMode ? scrollNodeRef.current : null);
  }, [shapeMode]);

  return (
    <div className="relative flex min-w-0 flex-1 h-full diff-container">
      {!highlightReady && (
        <div className="absolute top-0 left-0 right-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-[shimmer_1s_ease-in-out_infinite] bg-status-renamed/50 rounded-full" />
        </div>
      )}
      {shape && (
        <ShapeGutter
          rows={shape.rows}
          lineHeight={lineHeight}
          scrollNode={scrollNode}
          onToggleFold={shape.onToggleFold}
        />
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
          className={`h-full min-w-0 flex-1 bg-surface-panel ${
            hideScrollbar ? "scrollbar-none" : "scrollbar-thin"
          }`}
          style={CODE_VIEW_STYLE}
        />
      </DiffErrorBoundary>
    </div>
  );
}

const CODE_VIEW_STYLE = { overflow: "auto" } as const;
const EMPTY_HUNKS: DiffHunk[] = [];
const EMPTY_ANNOTATIONS: PierreLineAnnotation<AnnotationMeta>[] = [];

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
    // Listed to invalidate on, not read in the body — hence the suppression.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
