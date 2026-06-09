import { type ReactNode, useMemo, useRef, Component } from "react";
import { MultiFileDiff, FileDiff } from "@pierre/diffs/react";
import type { FileContents } from "@pierre/diffs/react";
import {
  getSingularPatch,
  setLanguageOverride,
  areFilesEqual,
  areOptionsEqual,
} from "@pierre/diffs";
import { useVirtualFileMetrics } from "../../hooks";
import { useReviewStore } from "../../stores";
import { stringHash } from "../../utils/string-hash";
import type { DiffHunk } from "../../types";
import type { SupportedLanguages } from "./languageMap";
import {
  useDiffAnnotationModel,
  useAdaptiveLineDiffType,
  useSyntaxHighlightReady,
  type TokenHoverHandler,
  type TokenClickHandler,
} from "./diff-model";

export type { TokenHoverHandler, TokenClickHandler };

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

interface DiffViewProps {
  diffPatch: string;
  viewMode: "unified" | "split";
  hunks: DiffHunk[];
  theme: string;
  fontCSS: string;
  onViewInFile?: (line: number) => void;
  // File contents for expansion support
  fileName: string;
  oldContent?: string;
  newContent?: string;
  /** Language override for syntax highlighting */
  language?: SupportedLanguages;
  /** Whether to expand all unchanged sections (default: true for full file view) */
  expandUnchanged?: boolean;
  /** Line number to highlight (scrolling is handled by the container owner) */
  highlightLine?: number | null;
  /** Line height in px — fed to the virtualizer's height estimates */
  lineHeight?: number;
  /** Token enter/leave hooks (e.g. LSP hover) wired into pierre/diffs options */
  onTokenEnter?: TokenHoverHandler;
  onTokenLeave?: TokenHoverHandler;
  onTokenClick?: TokenClickHandler;
}

/**
 * Embedded diff renderer for surfaces that own their own scroll container
 * (GroupDiffViewer, WorkingTreeMultiFileDiffViewer) — rendered inside a
 * pierre `Virtualizer`. The single-file viewer uses the CodeView-based
 * FileCodeView instead.
 */
export function DiffView({
  diffPatch,
  viewMode,
  hunks,
  theme,
  fontCSS,
  onViewInFile,
  fileName,
  oldContent,
  newContent,
  language,
  expandUnchanged: expandUnchangedProp = true,
  highlightLine,
  lineHeight = 21,
  onTokenEnter,
  onTokenLeave,
  onTokenClick,
}: DiffViewProps): ReactNode {
  const diffOverflow = useReviewStore((s) => s.diffOverflow);

  const filePath = hunks[0]?.filePath ?? "";
  const {
    lineAnnotations,
    renderAnnotation,
    handleLineSelectionEnd,
    handleGutterUtilityClick,
    annotationHighlightCSS,
  } = useDiffAnnotationModel({ hunks, filePath, fileName, onViewInFile });

  // Hash file contents once for use in cache keys and content-change detection.
  const oldContentHash = useMemo(
    () => stringHash(oldContent ?? ""),
    [oldContent],
  );
  const newContentHash = useMemo(
    () => stringHash(newContent ?? ""),
    [newContent],
  );

  // Track when syntax highlighting finishes.
  // Include content hashes so the shimmer resets when file content changes
  // (the MultiFileDiff key forces a remount, recreating the shadow DOM).
  const diffContainerRef = useRef<HTMLDivElement | null>(null);
  const contentKey = `${fileName}:${oldContentHash}:${newContentHash}`;
  const highlightReady = useSyntaxHighlightReady(diffContainerRef, contentKey);

  // Create file contents for MultiFileDiff when available
  // Use != null to catch both null and undefined (Rust None serializes to null)
  // For new files, oldContent is null but we can use empty string
  // For deleted files, newContent is null but we can use empty string
  const hasFileContents = oldContent != null || newContent != null;

  // Use areFilesEqual to prevent unnecessary re-renders when file contents haven't changed
  const oldFileRef = useRef<FileContents | undefined>(undefined);
  const oldFile = useMemo<FileContents | undefined>(() => {
    const nextFile = hasFileContents
      ? {
          name: fileName,
          contents: oldContent ?? "",
          lang: language,
          cacheKey: `old:${fileName}:${oldContentHash}`,
        }
      : undefined;
    if (areFilesEqual(oldFileRef.current, nextFile)) {
      return oldFileRef.current;
    }
    oldFileRef.current = nextFile;
    return nextFile;
  }, [hasFileContents, fileName, oldContent, language]);

  const newFileRef = useRef<FileContents | undefined>(undefined);
  const newFile = useMemo<FileContents | undefined>(() => {
    const nextFile = hasFileContents
      ? {
          name: fileName,
          contents: newContent ?? "",
          lang: language,
          cacheKey: `new:${fileName}:${newContentHash}`,
        }
      : undefined;
    if (areFilesEqual(newFileRef.current, nextFile)) {
      return newFileRef.current;
    }
    newFileRef.current = nextFile;
    return nextFile;
  }, [hasFileContents, fileName, newContent, language]);

  // Parse patch for FileDiff when no file contents available (patch-only path)
  // This allows us to override language for syntax highlighting (e.g., shebang detection)
  const parsedFileDiff = useMemo(() => {
    if (hasFileContents) return null;
    const fileDiff = getSingularPatch(diffPatch);
    return language ? setLanguageOverride(fileDiff, language) : fileDiff;
  }, [hasFileContents, diffPatch, language]);

  const lineDiffType = useAdaptiveLineDiffType(
    fileName,
    oldContent,
    newContent,
  );

  // Define diff options type inline to avoid type mismatch between FileOptions and FileDiffOptions
  type DiffOptionsType = {
    diffStyle: "unified" | "split";
    theme: { dark: string; light: string };
    themeType: "dark";
    diffIndicators: "none";
    disableBackground: boolean;
    disableFileHeader: true;
    enableGutterUtility: boolean;
    enableLineSelection: boolean;
    onGutterUtilityClick: typeof handleGutterUtilityClick;
    onLineSelectionEnd: typeof handleLineSelectionEnd;
    onTokenEnter?: TokenHoverHandler;
    onTokenLeave?: TokenHoverHandler;
    onTokenClick?: TokenClickHandler;
    unsafeCSS: string;
    expandUnchanged: boolean;
    expansionLineCount: number;
    hunkSeparators: "line-info";
    tokenizeMaxLineLength: number;
    maxLineDiffLength: number;
    lineDiffType: "word" | "word-alt" | "char" | "none";
    overflow: "scroll" | "wrap";
  };

  // Memoize diffOptions with custom equality check to prevent unnecessary re-renders
  const diffOptionsRef = useRef<DiffOptionsType>(undefined);
  const diffOptions = useMemo<DiffOptionsType>(() => {
    const nextOptions: DiffOptionsType = {
      diffStyle: viewMode,
      theme: {
        dark: theme,
        light: theme,
      },
      themeType: "dark",
      diffIndicators: "none",
      disableBackground: false,
      // FileViewerToolbar already shows the filename and review actions —
      // suppress pierre's default per-file header to avoid duplication.
      disableFileHeader: true,
      enableGutterUtility: true,
      enableLineSelection: true,
      onGutterUtilityClick: handleGutterUtilityClick,
      onLineSelectionEnd: handleLineSelectionEnd,
      onTokenEnter,
      onTokenLeave,
      onTokenClick,
      unsafeCSS: fontCSS + annotationHighlightCSS,
      expandUnchanged: expandUnchangedProp,
      expansionLineCount: 20,
      hunkSeparators: "line-info",
      // Performance optimizations
      tokenizeMaxLineLength: 1000, // Skip syntax highlighting for very long lines
      maxLineDiffLength: 500, // Skip word-level diff for long lines
      lineDiffType, // Adaptive based on file type/size, user preference as default
      overflow: diffOverflow,
    };
    // Use areOptionsEqual from @pierre/diffs to avoid unnecessary re-renders
    if (
      diffOptionsRef.current &&
      areOptionsEqual(diffOptionsRef.current, nextOptions)
    ) {
      return diffOptionsRef.current;
    }
    diffOptionsRef.current = nextOptions;
    return nextOptions;
  }, [
    viewMode,
    theme,
    fontCSS,
    annotationHighlightCSS,
    lineDiffType,
    diffOverflow,
    handleGutterUtilityClick,
    handleLineSelectionEnd,
    expandUnchangedProp,
    onTokenEnter,
    onTokenLeave,
    onTokenClick,
  ]);

  const metrics = useVirtualFileMetrics(lineHeight);

  return (
    <div className="diff-container relative" ref={diffContainerRef}>
      {!highlightReady && (
        <div className="absolute top-0 left-0 right-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-[shimmer_1s_ease-in-out_infinite] bg-status-renamed/50 rounded-full" />
        </div>
      )}
      <DiffErrorBoundary
        key={fileName}
        fallback={
          <div className="p-6">
            <div className="mb-4 rounded-lg bg-status-rejected/10 border border-status-rejected/20 p-4">
              <p className="text-status-rejected">Failed to render diff view</p>
            </div>
            <div className="rounded-lg bg-surface-raised/30 p-4">
              <p className="mb-2 text-sm text-fg-muted">Raw patch:</p>
              <pre className="overflow-auto font-mono text-xs text-fg-secondary leading-relaxed">
                {diffPatch}
              </pre>
            </div>
          </div>
        }
      >
        {hasFileContents && oldFile && newFile ? (
          <MultiFileDiff
            key={`${oldFile.cacheKey}|${newFile.cacheKey}`}
            oldFile={oldFile}
            newFile={newFile}
            metrics={metrics}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            selectedLines={
              highlightLine
                ? {
                    start: highlightLine,
                    end: highlightLine,
                    side: "additions",
                  }
                : null
            }
            options={diffOptions}
          />
        ) : (
          <FileDiff
            fileDiff={parsedFileDiff!}
            metrics={metrics}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            selectedLines={
              highlightLine
                ? {
                    start: highlightLine,
                    end: highlightLine,
                    side: "additions",
                  }
                : null
            }
            options={diffOptions}
          />
        )}
      </DiffErrorBoundary>
    </div>
  );
}
