import {
  type ReactNode,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  Component,
} from "react";
import { MultiFileDiff, FileDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileContents } from "@pierre/diffs/react";
import {
  getSingularPatch,
  setLanguageOverride,
  areFilesEqual,
  areOptionsEqual,
} from "@pierre/diffs";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import type { DiffHunk, HunkState, LineAnnotation } from "../../types";
import { isHunkTrusted } from "../../types";
import { getChangedLinesKey as getChangedLinesKeyUtil } from "../../utils/changed-lines-key";
import { SimpleTooltip } from "../../components/ui/tooltip";
import {
  NewAnnotationEditor,
  UserAnnotationDisplay,
  HunkAnnotationPanel,
  TrustedHunkBadge,
  WorkingTreeHunkPanel,
} from "./annotations";
import { getLastChangedLine } from "./hunkUtils";
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

/** Validates that a line number is valid for @pierre/diffs (must be >= 1). */
function isValidLineNumber(lineNumber: number): boolean {
  return lineNumber >= 1;
}

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
  /** Whether to expand all unchanged sections (default: true for full file view) */
  expandUnchanged?: boolean;
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
  expandUnchanged: expandUnchangedProp = true,
}: DiffViewProps): ReactNode {
  // Reactive subscriptions — values used in render output
  const reviewState = useReviewStore((s) => s.reviewState);
  const allHunks = useReviewStore((s) => s.hunks);
  const prefLineDiffType = useReviewStore((s) => s.diffLineDiffType);
  const prefDiffIndicators = useReviewStore((s) => s.diffIndicators);
  const pendingCommentHunkId = useReviewStore((s) => s.pendingCommentHunkId);
  const workingTreeDiffMode = useReviewStore((s) => s.workingTreeDiffMode);
  const workingTreeDiffFile = useReviewStore((s) => s.workingTreeDiffFile);

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

    const { lineNumber, side } = getLastChangedLine(targetHunk);
    setNewAnnotationLine({ lineNumber, side, hunkId: pendingCommentHunkId });
    useReviewStore.getState().setPendingCommentHunkId(null);
  }, [pendingCommentHunkId, hunks, newAnnotationLine]);

  const filePath = hunks[0]?.filePath ?? "";

  const fileAnnotations = useMemo(() => {
    const all = reviewState?.annotations ?? [];
    return all.filter((a) => a.filePath === filePath);
  }, [reviewState?.annotations, filePath]);

  const hunkStates = reviewState?.hunks;

  // Build lookup from hunk ID to hunk object (from store, which has movePairId set)
  const hunkById = useMemo(() => {
    const map = new Map<string, DiffHunk>();
    for (const h of allHunks) {
      map.set(h.id, h);
    }
    return map;
  }, [allHunks]);

  const fileHunkStates = useMemo(() => {
    if (!hunkStates) return hunkStates;
    const states: Record<string, HunkState> = {};
    let changed = false;
    for (const hunk of hunks) {
      const s = hunkStates[hunk.id];
      if (s) {
        states[hunk.id] = s;
        changed = true;
      }
    }
    return changed ? states : undefined;
  }, [hunks, hunkStates]);

  // Build line annotations for each hunk - position at last changed line
  // Memoized to preserve reference stability — @pierre/diffs uses reference
  // equality on lineAnnotations to decide whether to re-render the diff.
  const hunkAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(() => {
    return hunks.flatMap((hunk): DiffLineAnnotation<AnnotationMeta>[] => {
      const hunkState = fileHunkStates?.[hunk.id];
      // Prop hunks come from getFileContent (per-file, no movePairId).
      // Store hunks have movePairId set by detect_move_pairs. Use hunkById for O(1) lookup.
      const movePairId = hunkById.get(hunk.id)?.movePairId;
      const pairedHunk = movePairId ? (hunkById.get(movePairId) ?? null) : null;
      const isSource = pairedHunk ? isDeletionOnly(hunk) : false;

      const changedLines = hunk.lines.filter(
        (l) => l.type === "added" || l.type === "removed",
      );
      const lastChanged = changedLines[changedLines.length - 1];

      let side: "additions" | "deletions";
      let lineNumber: number;

      if (!lastChanged) {
        side = isSource ? "deletions" : "additions";
        lineNumber = isSource ? hunk.oldStart : hunk.newStart;
      } else if (lastChanged.type === "removed") {
        side = "deletions";
        lineNumber = lastChanged.oldLineNumber ?? hunk.oldStart;
      } else {
        side = "additions";
        lineNumber = lastChanged.newLineNumber ?? hunk.newStart;
      }

      if (!isValidLineNumber(lineNumber)) {
        console.warn(
          `[DiffView] Skipping hunk annotation with invalid lineNumber: ${lineNumber}`,
          { hunkId: hunk.id, side },
        );
        return [];
      }

      return [
        {
          side,
          lineNumber,
          metadata: {
            type: "hunk" as const,
            data: { hunk, hunkState, pairedHunk, isSource },
          },
        },
      ];
    });
  }, [hunks, fileHunkStates, hunkById]);

  // Build lookup from changed-lines key to hunk IDs for batch operations.
  // Groups identical changes across different files for "approve all identical" feature.
  const changedLinesKeyToHunkIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of allHunks) {
      const key = getChangedLinesKeyUtil(h);
      if (!key) continue;
      const ids = map.get(key) ?? [];
      ids.push(h.id);
      map.set(key, ids);
    }
    return map;
  }, [allHunks]);

  // Get similar hunks for a given hunk (same changed lines, different context/files)
  const getSimilarHunks = useCallback(
    (hunk: DiffHunk): DiffHunk[] => {
      const key = getChangedLinesKeyUtil(hunk);
      if (!key) return [hunk];
      const ids = changedLinesKeyToHunkIds.get(key) ?? [hunk.id];
      return ids.map((id) => hunkById.get(id)).filter(Boolean) as DiffHunk[];
    },
    [changedLinesKeyToHunkIds, hunkById],
  );

  // Build annotations for user comments
  // Include "file" annotations as well - they map to the "additions" side (new/compare version)
  const userAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(() => {
    return fileAnnotations.flatMap(
      (annotation): DiffLineAnnotation<AnnotationMeta>[] => {
        const lineNumber = annotation.endLineNumber ?? annotation.lineNumber;

        if (!isValidLineNumber(lineNumber)) {
          console.warn(
            `[DiffView] Skipping user annotation with invalid lineNumber: ${lineNumber}`,
            { annotationId: annotation.id },
          );
          return [];
        }

        return [
          {
            side: annotation.side === "old" ? "deletions" : "additions",
            lineNumber,
            metadata: { type: "user" as const, data: { annotation } },
          },
        ];
      },
    );
  }, [fileAnnotations]);

  // Combine all annotations into a stable reference
  const lineAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(() => {
    const newLineNumber =
      newAnnotationLine?.endLineNumber ?? newAnnotationLine?.lineNumber;

    if (
      !newAnnotationLine ||
      !newLineNumber ||
      !isValidLineNumber(newLineNumber)
    ) {
      return [...hunkAnnotations, ...userAnnotations];
    }

    const newAnnotation: DiffLineAnnotation<AnnotationMeta> = {
      side: newAnnotationLine.side === "old" ? "deletions" : "additions",
      lineNumber: newLineNumber,
      metadata: { type: "new" as const, data: {} },
    };

    return [...hunkAnnotations, ...userAnnotations, newAnnotation];
  }, [hunkAnnotations, userAnnotations, newAnnotationLine]);

  async function handleCopyHunk(hunk: DiffHunk) {
    const platform = getPlatformServices();
    await platform.clipboard.writeText(hunk.content);
  }

  function handleSaveNewAnnotation(content: string) {
    if (!newAnnotationLine) return;
    const { addAnnotation, nextHunkInFile } = useReviewStore.getState();
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
  }

  // Render annotation for each type - use ref pattern for stable function reference
  // Store non-store dependencies in a ref so the callback can access latest values
  // without causing re-renders. Store action functions are accessed via getState() at call time.
  const renderAnnotationDepsRef = useRef<{
    handleSaveNewAnnotation: typeof handleSaveNewAnnotation;
    setNewAnnotationLine: typeof setNewAnnotationLine;
    editingAnnotationId: typeof editingAnnotationId;
    setEditingAnnotationId: typeof setEditingAnnotationId;
    hunks: typeof hunks;
    getSimilarHunks: typeof getSimilarHunks;
    focusedHunkId: typeof focusedHunkId;
    focusedHunkRef: typeof focusedHunkRef;
    reviewState: typeof reviewState;
    hunkStates: typeof hunkStates;
    handleCopyHunk: typeof handleCopyHunk;
    onViewInFile: typeof onViewInFile;
    hunkById: typeof hunkById;
    newAnnotationLine: typeof newAnnotationLine;
    workingTreeDiffMode: typeof workingTreeDiffMode;
    isWorkingTreeFile: boolean;
  }>(null!);
  renderAnnotationDepsRef.current = {
    handleSaveNewAnnotation,
    setNewAnnotationLine,
    editingAnnotationId,
    setEditingAnnotationId,
    hunks,
    getSimilarHunks,
    focusedHunkId,
    focusedHunkRef,
    reviewState,
    hunkStates,
    handleCopyHunk,
    onViewInFile,
    hunkById,
    newAnnotationLine,
    workingTreeDiffMode,
    isWorkingTreeFile: workingTreeDiffFile === fileName,
  };

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMeta>) => {
      const deps = renderAnnotationDepsRef.current;
      const meta = annotation.metadata!;

      switch (meta.type) {
        case "new":
          return (
            <NewAnnotationEditor
              onSave={deps.handleSaveNewAnnotation}
              onCancel={() => {
                useReviewStore.setState({ scrollDrivenNavigation: true });
                deps.setNewAnnotationLine(null);
              }}
            />
          );

        case "user": {
          const { annotation: userAnnotation } = meta.data;
          return (
            <UserAnnotationDisplay
              annotation={userAnnotation}
              isEditing={deps.editingAnnotationId === userAnnotation.id}
              onEdit={() => deps.setEditingAnnotationId(userAnnotation.id)}
              onSave={(content) => {
                useReviewStore
                  .getState()
                  .updateAnnotation(userAnnotation.id, content);
                deps.setEditingAnnotationId(null);
              }}
              onCancel={() => deps.setEditingAnnotationId(null)}
              onDelete={() => {
                useReviewStore.getState().deleteAnnotation(userAnnotation.id);
                deps.setEditingAnnotationId(null);
              }}
            />
          );
        }

        case "hunk": {
          const { hunk, hunkState, pairedHunk, isSource } = meta.data;
          const hunkIndex = deps.hunks.findIndex((h) => h.id === hunk.id);

          // Working tree mode: render lightweight stage/unstage panel
          if (deps.isWorkingTreeFile && deps.workingTreeDiffMode) {
            return (
              <WorkingTreeHunkPanel
                hunk={hunk}
                focusedHunkId={deps.focusedHunkId}
                focusedHunkRef={deps.focusedHunkRef}
                hunkPosition={hunkIndex >= 0 ? hunkIndex + 1 : undefined}
                totalHunksInFile={deps.hunks.length}
                mode={deps.workingTreeDiffMode}
                onStage={(contentHash) => {
                  useReviewStore
                    .getState()
                    .stageHunks(hunk.filePath, [contentHash]);
                }}
                onUnstage={(contentHash) => {
                  useReviewStore
                    .getState()
                    .unstageHunks(hunk.filePath, [contentHash]);
                }}
                onCopyHunk={deps.handleCopyHunk}
                onViewInFile={deps.onViewInFile}
              />
            );
          }

          // Trusted hunk: compact badge instead of full panel
          const trustList = deps.reviewState?.trustList ?? [];
          if (!hunkState?.status && isHunkTrusted(hunkState, trustList)) {
            return (
              <TrustedHunkBadge
                hunk={hunk}
                hunkState={hunkState}
                focusedHunkId={deps.focusedHunkId}
                focusedHunkRef={deps.focusedHunkRef}
                trustList={trustList}
                onApprove={(hunkId) => {
                  const s = useReviewStore.getState();
                  s.approveHunk(hunkId);
                  s.nextHunkInFile();
                }}
                onReject={(hunkId) => {
                  const s = useReviewStore.getState();
                  s.rejectHunk(hunkId);
                  const targetHunk = deps.hunks.find((h) => h.id === hunkId);
                  if (targetHunk && !deps.newAnnotationLine) {
                    const { lineNumber, side } = getLastChangedLine(targetHunk);
                    deps.setNewAnnotationLine({ lineNumber, side, hunkId });
                  }
                }}
                onRemoveTrustPattern={(pattern) =>
                  useReviewStore.getState().removeTrustPattern(pattern)
                }
                onCopyHunk={deps.handleCopyHunk}
              />
            );
          }

          // Review mode: full annotation panel
          const similarHunks = deps.getSimilarHunks(hunk);
          return (
            <HunkAnnotationPanel
              hunk={hunk}
              hunkState={hunkState}
              pairedHunk={pairedHunk}
              isSource={isSource}
              focusedHunkId={deps.focusedHunkId}
              focusedHunkRef={deps.focusedHunkRef}
              trustList={deps.reviewState?.trustList ?? []}
              hunkPosition={hunkIndex >= 0 ? hunkIndex + 1 : undefined}
              totalHunksInFile={deps.hunks.length}
              similarHunks={similarHunks}
              allHunkStates={deps.hunkStates ?? {}}
              onApprove={(hunkId) => {
                const s = useReviewStore.getState();
                s.approveHunk(hunkId);
                s.nextHunkInFile();
              }}
              onUnapprove={(hunkId) =>
                useReviewStore.getState().unapproveHunk(hunkId)
              }
              onReject={(hunkId) => {
                const s = useReviewStore.getState();
                s.rejectHunk(hunkId);
                const targetHunk = deps.hunks.find((h) => h.id === hunkId);
                if (targetHunk && !deps.newAnnotationLine) {
                  const { lineNumber, side } = getLastChangedLine(targetHunk);
                  deps.setNewAnnotationLine({ lineNumber, side, hunkId });
                }
              }}
              onUnreject={(hunkId) =>
                useReviewStore.getState().unrejectHunk(hunkId)
              }
              onSaveForLater={(hunkId) =>
                useReviewStore.getState().saveHunkForLater(hunkId)
              }
              onUnsaveForLater={(hunkId) =>
                useReviewStore.getState().unsaveHunkForLater(hunkId)
              }
              onApprovePair={(hunkIds) => {
                const s = useReviewStore.getState();
                s.approveHunkIds(hunkIds);
                s.nextHunkInFile();
              }}
              onRejectPair={(hunkIds) => {
                const s = useReviewStore.getState();
                s.rejectHunkIds(hunkIds);
                s.nextHunkInFile();
              }}
              onAddTrustPattern={(pattern) =>
                useReviewStore.getState().addTrustPattern(pattern)
              }
              onRemoveTrustPattern={(pattern) =>
                useReviewStore.getState().removeTrustPattern(pattern)
              }
              onReclassifyHunks={(hunkIds) =>
                useReviewStore.getState().reclassifyHunks(hunkIds)
              }
              onCopyHunk={deps.handleCopyHunk}
              onViewInFile={deps.onViewInFile}
              onApproveAllSimilar={(hunkIds) => {
                const s = useReviewStore.getState();
                s.approveHunkIds(hunkIds);
                s.nextHunkInFile();
              }}
              onRejectAllSimilar={(hunkIds) => {
                const s = useReviewStore.getState();
                s.rejectHunkIds(hunkIds);
                s.nextHunkInFile();
              }}
              onNavigateToHunk={(hunkId) => {
                const targetHunk = deps.hunkById.get(hunkId);
                if (targetHunk) {
                  useReviewStore
                    .getState()
                    .setSelectedFile(targetHunk.filePath);
                }
              }}
            />
          );
        }
      }
    },
    [],
  );

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
          cacheKey: `old:${fileName}:${(oldContent ?? "").length}`,
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
          cacheKey: `new:${fileName}:${(newContent ?? "").length}`,
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
        background-image: linear-gradient(to right, color-mix(in srgb, var(--color-focus-ring) 7%, transparent), color-mix(in srgb, var(--color-focus-ring) 3%, transparent)) !important;
      }
      :is(${selector}) > [data-column-number]:last-of-type {
        box-shadow: inset -2px 0 0 color-mix(in srgb, var(--color-focus-ring) 35%, transparent);
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

      if (!isValidLineNumber(start) || !isValidLineNumber(end)) {
        console.warn(
          `[DiffView] Ignoring selection with invalid line range: ${start}-${end}`,
        );
        return;
      }

      // Single line selections are handled by the hover "+" button
      if (start === end) return;

      setNewAnnotationLine({
        lineNumber: start,
        endLineNumber: end,
        side: range.side === "deletions" ? "old" : "new",
        hunkId: "selection",
      });
    },
    [],
  );

  // Define diff options type inline to avoid type mismatch between FileOptions and FileDiffOptions
  type DiffOptionsType = {
    diffStyle: "unified" | "split";
    theme: { dark: string; light: string };
    themeType: "dark";
    diffIndicators: "classic" | "bars" | "none";
    disableBackground: boolean;
    enableHoverUtility: boolean;
    enableLineSelection: boolean;
    onLineSelectionEnd: typeof handleLineSelectionEnd;
    unsafeCSS: string;
    expandUnchanged: boolean;
    expansionLineCount: number;
    hunkSeparators: "line-info";
    tokenizeMaxLineLength: number;
    maxLineDiffLength: number;
    lineDiffType: "word" | "word-alt" | "char" | "none";
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
      diffIndicators: prefDiffIndicators,
      disableBackground: false,
      enableHoverUtility: true,
      enableLineSelection: true,
      onLineSelectionEnd: handleLineSelectionEnd,
      unsafeCSS: fontSizeCSS + annotationHighlightCSS,
      expandUnchanged: expandUnchangedProp,
      expansionLineCount: 20,
      hunkSeparators: "line-info",
      // Performance optimizations
      tokenizeMaxLineLength: 1000, // Skip syntax highlighting for very long lines
      maxLineDiffLength: 500, // Skip word-level diff for long lines
      lineDiffType, // Adaptive based on file type/size, user preference as default
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
    prefDiffIndicators,
    fontSizeCSS,
    annotationHighlightCSS,
    lineDiffType,
    handleLineSelectionEnd,
    expandUnchangedProp,
  ]);

  // Stable renderHoverUtility using ref pattern to avoid re-renders
  const setNewAnnotationLineRef = useRef(setNewAnnotationLine);
  setNewAnnotationLineRef.current = setNewAnnotationLine;

  const renderHoverUtility = useCallback(
    (
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
            className="flex h-5 w-5 items-center justify-center rounded bg-status-renamed/80 text-surface shadow-lg transition-colors hover:bg-status-renamed hover:scale-110"
            onClick={() => {
              const hoveredLine = getHoveredLine();
              if (!hoveredLine) return;
              setNewAnnotationLineRef.current({
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
    },
    [],
  );

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
            oldFile={oldFile}
            newFile={newFile}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            renderHoverUtility={renderHoverUtility}
            options={diffOptions}
          />
        ) : (
          <FileDiff
            fileDiff={parsedFileDiff!}
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
