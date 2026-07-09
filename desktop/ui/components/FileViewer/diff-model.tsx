import {
  type ReactNode,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { DiffLineAnnotation, TokenEventBase } from "@pierre/diffs";
import { useReviewStore } from "../../stores";
import { useAllHunks, useHunkById } from "../../stores/selectors/hunks";
import { getPlatformServices } from "../../platform";
import { countLines } from "../../utils/count-lines";
import type {
  CommitEntry,
  DiffHunk,
  HunkState,
  LineAnnotation,
} from "../../types";
import { isHunkTrusted } from "../../types";
import { isEmptyFilter } from "../../types/hunkFilter";
import { hunkMatches } from "../../types/scope";
import { computeCommitGroups } from "../../stores/selectors/groups";
import { singleCommitScope } from "../FilesPanel/commitScope";
import { getChangedLinesKey as getChangedLinesKeyUtil } from "../../utils/changed-lines-key";
import {
  NewAnnotationEditor,
  UserAnnotationDisplay,
  HunkAnnotationPanel,
  TrustedHunkBadge,
  WorkingTreeHunkPanel,
  CollapsedHunkStrip,
} from "./annotations";
import { getLastChangedLine } from "./hunkUtils";
import { truncateSubject } from "../FilesPanel/commitFormat";

export type TokenHoverHandler = (
  props: TokenEventBase,
  event: PointerEvent,
) => void;

export type TokenClickHandler = (
  props: TokenEventBase,
  event: MouseEvent,
) => void;

/** Returns true if a hunk contains only deletions (source of a move). */
function isDeletionOnly(hunk: DiffHunk): boolean {
  return (
    hunk.lines.every((l) => l.type === "removed" || l.type === "context") &&
    hunk.lines.some((l) => l.type === "removed")
  );
}

interface HunkAnnotationMeta {
  hunk: DiffHunk;
  hunkState: HunkState | undefined;
  pairedHunk: DiffHunk | null;
  isSource: boolean;
}

interface UserAnnotationMeta {
  annotation: LineAnnotation;
}

export type AnnotationMeta =
  | { type: "hunk"; data: HunkAnnotationMeta }
  | { type: "user"; data: UserAnnotationMeta }
  | { type: "new"; data: Record<string, never> };

/** Validates that a line number is valid for @pierre/diffs (must be >= 1). */
export function isValidLineNumber(lineNumber: number): boolean {
  return lineNumber >= 1;
}

const LOCK_FILE_SUFFIXES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
];

/**
 * Word-level diffing is noisy in JSON and slow in very large files —
 * adapt the user's preference per file.
 */
export function useAdaptiveLineDiffType(
  fileName: string,
  oldContent: string | undefined,
  newContent: string | undefined,
): "word" | "word-alt" | "char" | "none" {
  const prefLineDiffType = useReviewStore((s) => s.diffLineDiffType);
  const isJsonFile = fileName.endsWith(".json");
  const isLockFile = LOCK_FILE_SUFFIXES.some((s) => fileName.endsWith(s));
  const totalLines = useMemo(
    () => countLines(oldContent) + countLines(newContent),
    [oldContent, newContent],
  );
  const isLargeFile = totalLines > 5000;

  return isLockFile || isLargeFile || (isJsonFile && totalLines > 1000)
    ? "none"
    : prefLineDiffType;
}

// Detects when @pierre/diffs finishes syntax highlighting by polling
// for styled <span> elements inside the shadow DOM of the diffs-container
// custom element. We poll because the shadow root is not observable via
// MutationObserver from an ancestor outside the shadow boundary.
export function useSyntaxHighlightReady(
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

export interface NewAnnotationLine {
  lineNumber: number;
  endLineNumber?: number;
  side: "old" | "new";
  hunkId: string;
}

interface DiffAnnotationModelOptions {
  hunks: DiffHunk[];
  /** Repo-relative path of the rendered file (annotations are keyed by it) */
  filePath: string;
  /** File name used for working-tree-mode detection (same as filePath today) */
  fileName: string;
  onViewInFile?: (line: number) => void;
}

export interface DiffAnnotationModel {
  lineAnnotations: DiffLineAnnotation<AnnotationMeta>[];
  renderAnnotation: (
    annotation: DiffLineAnnotation<AnnotationMeta>,
  ) => ReactNode;
  newAnnotationLine: NewAnnotationLine | null;
  setNewAnnotationLine: (line: NewAnnotationLine | null) => void;
  handleLineSelectionEnd: (
    range: { start: number; end: number; side?: string } | null,
  ) => void;
  handleGutterUtilityClick: (range: {
    start: number;
    end: number;
    side?: string;
  }) => void;
  /** CSS highlighting lines covered by user annotations (for unsafeCSS) */
  annotationHighlightCSS: string;
  /**
   * Changes whenever state read by renderAnnotation (via its deps ref)
   * changes. CodeView only re-invokes annotation renderers when the item
   * version bumps — unlike MultiFileDiff, which re-rendered them on every
   * React render — so consumers must fold this into the item version or
   * edit mode, trust changes, and working-tree toggles render stale panels.
   */
  renderRevision: number;
}

/**
 * The full annotation model for a diff surface: hunk review panels, user
 * comments, and the new-comment editor, plus the selection/gutter handlers
 * that create comments. Shared between the embedded DiffView renderer and
 * the CodeView-based single-file viewer.
 */
export function useDiffAnnotationModel({
  hunks,
  filePath,
  fileName,
  onViewInFile,
}: DiffAnnotationModelOptions): DiffAnnotationModel {
  // Reactive subscriptions — values used in render output
  const reviewState = useReviewStore((s) => s.reviewState);
  const allHunks = useAllHunks();
  const pendingCommentHunkId = useReviewStore((s) => s.pendingCommentHunkId);
  const workingTreeDiffMode = useReviewStore((s) => s.workingTreeDiffMode);
  const workingTreeDiffFile = useReviewStore((s) => s.workingTreeDiffFile);
  const readOnlyPreview = useReviewStore((s) => s.readOnlyPreview);
  const attribution = useReviewStore((s) => s.attribution);
  const reviewFilter = useReviewStore((s) => s.reviewFilter);
  const scope = useReviewStore((s) => s.scope);

  const commitByHash = useMemo(() => {
    const map = new Map<string, CommitEntry>();
    attribution?.commits.forEach((c) => map.set(c.hash, c));
    return map;
  }, [attribution]);

  // Scope to the clicked commit's group — looked up from the same commit
  // grouping the Commits sidebar list and the walk bar use, so a provenance
  // tag click lands on exactly the same hunk set as clicking that commit's
  // group header would.
  const handleScopeToCommit = useCallback(
    (sha: string) => {
      const group = computeCommitGroups(allHunks, attribution ?? null).find(
        (g) => g.key === sha,
      );
      if (group) {
        const state = useReviewStore.getState();
        if (state.guideMode) state.setGuideMode(false);
        state.setScope(singleCommitScope(group));
      }
    },
    [allHunks, attribution],
  );

  // Hunks outside the active review scope (e.g. a commit filter) collapse to
  // a thin strip until explicitly expanded. Local + reset on file change —
  // this is a per-viewing preference, not review state.
  const [expandedHunkIds, setExpandedHunkIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setExpandedHunkIds(new Set());
  }, [filePath]);

  // Annotation editing state
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(
    null,
  );
  const [newAnnotationLine, setNewAnnotationLine] =
    useState<NewAnnotationLine | null>(null);

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

  const fileAnnotations = useMemo(() => {
    const all = reviewState?.annotations ?? [];
    return all.filter((a) => a.filePath === filePath);
  }, [reviewState?.annotations, filePath]);

  const hunkStates = reviewState?.hunks;

  // Shared cross-file lookup, cached on filesByPath identity.
  const hunkById = useHunkById();

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

  // Hunks in this file outside the active predicate filter/scope — the one
  // pass over `hunks` both the collapsed-strip decision in renderAnnotation
  // and scopeDimCSS's line-dimming need, computed once instead of each
  // independently re-running the same hunkMatches predicate.
  const outOfScopeHunkIds = useMemo(() => {
    if (isEmptyFilter(reviewFilter) && !scope) return null;
    const trustList = reviewState?.trustList ?? [];
    const set = new Set<string>();
    for (const hunk of hunks) {
      const inScope = hunkMatches({
        hunkId: hunk.id,
        hunkState: fileHunkStates?.[hunk.id],
        filePath,
        trustList,
        filter: reviewFilter,
        scope,
      });
      if (!inScope) set.add(hunk.id);
    }
    return set;
  }, [
    hunks,
    fileHunkStates,
    filePath,
    reviewFilter,
    scope,
    reviewState?.trustList,
  ]);

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

      // Prefer the additions (right) side so the annotation bar renders in the
      // "new code" pane during split view.  Only fall back to the deletions
      // (left) side for pure-deletion hunks or move-pair sources.
      const lastAdded = [...changedLines]
        .reverse()
        .find((l) => l.type === "added");

      if (!lastChanged) {
        side = isSource ? "deletions" : "additions";
        lineNumber = isSource ? hunk.oldStart : hunk.newStart;
      } else if (isSource || !lastAdded) {
        side = "deletions";
        lineNumber =
          (lastChanged.type === "removed"
            ? lastChanged.oldLineNumber
            : lastChanged.newLineNumber) ?? hunk.oldStart;
      } else {
        side = "additions";
        lineNumber = lastAdded.newLineNumber ?? hunk.newStart;
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
            type: "hunk",
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
            metadata: { type: "user", data: { annotation } },
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
      metadata: { type: "new", data: {} },
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
      commentHunkId !== "hover" &&
      commentHunkId !== "selection" &&
      commentHunkId !== "gutter";
    if (
      isHunkComment &&
      reviewState?.hunks[commentHunkId]?.status?.value === "rejected"
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
    reviewState: typeof reviewState;
    hunkStates: typeof hunkStates;
    handleCopyHunk: typeof handleCopyHunk;
    onViewInFile: typeof onViewInFile;
    hunkById: typeof hunkById;
    newAnnotationLine: typeof newAnnotationLine;
    workingTreeDiffMode: typeof workingTreeDiffMode;
    isWorkingTreeFile: boolean;
    readOnlyPreview: boolean;
    attribution: typeof attribution;
    commitByHash: typeof commitByHash;
    outOfScopeHunkIds: typeof outOfScopeHunkIds;
    handleScopeToCommit: typeof handleScopeToCommit;
    expandedHunkIds: typeof expandedHunkIds;
    setExpandedHunkIds: typeof setExpandedHunkIds;
  }>(null!);
  renderAnnotationDepsRef.current = {
    handleSaveNewAnnotation,
    setNewAnnotationLine,
    editingAnnotationId,
    setEditingAnnotationId,
    hunks,
    getSimilarHunks,
    reviewState,
    hunkStates,
    handleCopyHunk,
    onViewInFile,
    hunkById,
    newAnnotationLine,
    workingTreeDiffMode,
    isWorkingTreeFile: workingTreeDiffFile === fileName,
    readOnlyPreview,
    attribution,
    commitByHash,
    outOfScopeHunkIds,
    handleScopeToCommit,
    expandedHunkIds,
    setExpandedHunkIds,
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
              onResolve={() =>
                useReviewStore.getState().resolveAnnotation(userAnnotation.id)
              }
              onUnresolve={() =>
                useReviewStore.getState().unresolveAnnotation(userAnnotation.id)
              }
            />
          );
        }

        case "hunk": {
          const { hunk, hunkState, pairedHunk, isSource } = meta.data;
          const hunkIndex = deps.hunks.findIndex((h) => h.id === hunk.id);

          // Read-only preview: skip hunk action panels entirely
          if (deps.readOnlyPreview) {
            return null;
          }

          // Working tree mode: render lightweight stage/unstage panel
          if (deps.isWorkingTreeFile && deps.workingTreeDiffMode) {
            return (
              <WorkingTreeHunkPanel
                hunk={hunk}
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

          const trustList = deps.reviewState?.trustList ?? [];
          const hunkShas = deps.attribution?.hunkCommits[hunk.id];
          const commitTags: CommitEntry[] | null = deps.attribution
            ? (hunkShas ?? [])
                .map((sha) => deps.commitByHash.get(sha))
                .filter((c): c is CommitEntry => !!c)
            : null;

          // Scope-aware collapse: outside the active predicate filter or
          // scope (e.g. a commit scope), a hunk renders as a thin strip
          // until expanded.
          const outOfScope = deps.outOfScopeHunkIds?.has(hunk.id) ?? false;
          if (outOfScope && !deps.expandedHunkIds.has(hunk.id)) {
            const firstCommit = commitTags?.[0];
            const label = firstCommit
              ? `hunk from ${firstCommit.shortHash} ${truncateSubject(firstCommit.message, 40)}`
              : "uncommitted hunk";
            return (
              <CollapsedHunkStrip
                hunk={hunk}
                label={label}
                onExpand={() =>
                  deps.setExpandedHunkIds((prev) => new Set(prev).add(hunk.id))
                }
              />
            );
          }

          // Trusted hunk: compact badge instead of full panel
          if (!hunkState?.status && isHunkTrusted(hunkState, trustList)) {
            return (
              <TrustedHunkBadge
                hunk={hunk}
                hunkState={hunkState}
                trustList={trustList}
                commitTags={commitTags}
                onScopeToCommit={deps.handleScopeToCommit}
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
              trustList={deps.reviewState?.trustList ?? []}
              hunkPosition={hunkIndex >= 0 ? hunkIndex + 1 : undefined}
              totalHunksInFile={deps.hunks.length}
              similarHunks={similarHunks}
              allHunkStates={deps.hunkStates ?? {}}
              commitTags={commitTags}
              onScopeToCommit={deps.handleScopeToCommit}
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

  // Handle gutter utility button clicks (single-click or drag-to-select range).
  // Uses the library's built-in button + pointer handling which properly
  // coexists with enableLineSelection.
  const handleGutterUtilityClick = useCallback(
    (range: { start: number; end: number; side?: string }) => {
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);

      if (!isValidLineNumber(start) || !isValidLineNumber(end)) return;

      setNewAnnotationLine({
        lineNumber: start,
        endLineNumber: start !== end ? end : undefined,
        side: range.side === "deletions" ? "old" : "new",
        hunkId: "gutter",
      });
    },
    [],
  );

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

  // Dim the changed lines of collapsed (out-of-scope) hunks. @pierre/diffs
  // has no supported API to hide a hunk's lines outright, so this leans on
  // the same [data-line] CSS-injection path as annotationHighlightCSS to at
  // least visually recede them alongside the collapsed action panel. Reads
  // the same `outOfScopeHunkIds` set the collapsed-strip decision in
  // renderAnnotation uses, rather than recomputing the predicate.
  const scopeDimCSS = useMemo(() => {
    if (!outOfScopeHunkIds || outOfScopeHunkIds.size === 0) return "";
    const lineSelectors: string[] = [];
    for (const hunk of hunks) {
      if (expandedHunkIds.has(hunk.id)) continue;
      if (!outOfScopeHunkIds.has(hunk.id)) continue;
      for (const line of hunk.lines) {
        if (line.type === "added" && line.newLineNumber) {
          lineSelectors.push(`[data-line="${line.newLineNumber}"]`);
        } else if (line.type === "removed" && line.oldLineNumber) {
          lineSelectors.push(`[data-line="${line.oldLineNumber}"]`);
        }
      }
    }
    if (lineSelectors.length === 0) return "";
    const selector = [...new Set(lineSelectors)].join(", ");
    return `:is(${selector}) { opacity: 0.4; }`;
  }, [hunks, outOfScopeHunkIds, expandedHunkIds]);

  const renderRevisionRef = useRef(0);
  const renderRevision = useMemo(
    () => ++renderRevisionRef.current,
    // Everything renderAnnotation reads through the deps ref that is not
    // already part of lineAnnotations' identity.
    [
      editingAnnotationId,
      newAnnotationLine,
      hunks,
      hunkById,
      getSimilarHunks,
      hunkStates,
      reviewState?.trustList,
      onViewInFile,
      workingTreeDiffMode,
      workingTreeDiffFile,
      fileName,
      readOnlyPreview,
      attribution,
      outOfScopeHunkIds,
      expandedHunkIds,
    ],
  );

  return {
    lineAnnotations,
    renderAnnotation,
    newAnnotationLine,
    setNewAnnotationLine,
    handleLineSelectionEnd,
    handleGutterUtilityClick,
    annotationHighlightCSS: annotationHighlightCSS + scopeDimCSS,
    renderRevision,
  };
}
