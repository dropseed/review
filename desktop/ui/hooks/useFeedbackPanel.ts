import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useReviewStore } from "../stores";
import { useAllHunks } from "../stores/selectors/hunks";
import { getPlatformServices } from "../platform";
import {
  computeReviewProgress,
  type ReviewProgress,
} from "./useReviewProgress";
import type { Comparison, DiffHunk, LineAnnotation } from "../types";

/** Returns a human-readable line range string for a hunk (e.g. "10" or "10-15"). */
function hunkLineRange(hunk: DiffHunk): string {
  if (hunk.newCount <= 1) return `${hunk.newStart}`;
  return `${hunk.newStart}-${hunk.newStart + hunk.newCount - 1}`;
}

/** Returns true if the annotation falls within the hunk's new-side line range. */
function isAnnotationInHunk(a: LineAnnotation, hunk: DiffHunk): boolean {
  return (
    a.filePath === hunk.filePath &&
    a.lineNumber >= hunk.newStart &&
    a.lineNumber < hunk.newStart + hunk.newCount
  );
}

/** Re-indent the 2nd+ lines of multi-line content so it stays inside a
 * Markdown list item instead of breaking out into top-level blocks. */
function indentContinuation(text: string, indent: string): string {
  return text.replace(/\n/g, `\n${indent}`);
}

/** A "42" or "42-48" line reference, never the redundant "42-42". */
function annotationLineRef(a: LineAnnotation): string {
  return a.endLineNumber && a.endLineNumber !== a.lineNumber
    ? `${a.lineNumber}-${a.endLineNumber}`
    : `${a.lineNumber}`;
}

/** Human-readable label for the review's overall state. */
function reviewStateLabel(progress: ReviewProgress): string {
  switch (progress.state) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    default:
      return "In progress";
  }
}

/**
 * Generates a Markdown representation of the whole review: status, hunk
 * tallies, requested changes, comments, and notes. This is the document the
 * bottom action bar copies (and, for a PR, will eventually submit).
 */
function generateReviewMarkdown(
  comparison: Comparison | null,
  progress: ReviewProgress,
  rejectedHunks: RejectedHunkWithAnnotations[],
  standaloneAnnotations: LineAnnotation[],
  notes: string,
): string {
  const lines: string[] = [];

  lines.push(`# Review — ${comparison?.key ?? "working tree"}`);
  lines.push("");
  lines.push(
    `**${reviewStateLabel(progress)}** · ${progress.reviewedHunks}/${progress.totalHunks} hunks reviewed`,
  );
  lines.push(
    [
      `${progress.trustedHunks} trusted`,
      `${progress.approvedHunks} approved`,
      `${progress.rejectedHunks} changes requested`,
      `${progress.savedForLaterHunks} saved`,
      `${progress.pendingHunks} pending`,
    ].join(" · "),
  );
  lines.push("");

  if (rejectedHunks.length > 0) {
    lines.push("## Changes requested");
    lines.push("");
    for (const hunk of rejectedHunks) {
      lines.push(`- **${hunk.filePath}:${hunk.lineRange}**`);
      for (const annotation of hunk.annotations) {
        const suffix = annotation.resolvedAt ? " _(resolved)_" : "";
        const body = indentContinuation(annotation.content, "    ");
        lines.push(`  - ${body}${suffix}`);
      }
    }
    lines.push("");
  }

  if (standaloneAnnotations.length > 0) {
    lines.push("## Comments");
    lines.push("");
    for (const annotation of standaloneAnnotations) {
      const ref = annotationLineRef(annotation);
      const author = annotation.author ? ` _(${annotation.author})_` : "";
      const body = indentContinuation(annotation.content, "  ");
      lines.push(`- **${annotation.filePath}:${ref}** — ${body}${author}`);
    }
    lines.push("");
  }

  if (notes.trim()) {
    lines.push("## Notes");
    lines.push("");
    lines.push(notes.trim());
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export interface RejectedHunkWithAnnotations {
  filePath: string;
  lineRange: string;
  hunkId: string;
  annotations: LineAnnotation[];
}

export interface FeedbackPanelState {
  notes: string;
  /** Unresolved comments — every open comment, including those on rejected hunks. */
  openComments: LineAnnotation[];
  /** All resolved comments, regardless of hunk coverage. */
  resolvedAnnotations: LineAnnotation[];
  standaloneAnnotations: LineAnnotation[];
  setReviewNotes: (notes: string) => void;
  deleteAnnotation: (annotationId: string) => void;
  resolveAnnotation: (annotationId: string) => void;
  unresolveAnnotation: (annotationId: string) => void;
  resolveAllAnnotations: () => void;
  deleteResolvedAnnotations: () => void;
  /** True when notes or comments exist — gates the Notes "Clear" action. */
  hasClearableFeedback: boolean;
  /** True when the review has explicit content worth copying/submitting. */
  hasReviewContent: boolean;
  /** Overall review progress — drives the bottom action bar's status line. */
  progress: ReviewProgress;
  goToFile: (filePath: string) => void;
  rejectedHunks: RejectedHunkWithAnnotations[];
  copied: boolean;
  copyReviewToClipboard: () => Promise<void>;
  clearFeedback: () => void;
}

/** Sort comments by file path, then line, then creation time — stable list order. */
function byLocation(a: LineAnnotation, b: LineAnnotation): number {
  return (
    a.filePath.localeCompare(b.filePath) ||
    a.lineNumber - b.lineNumber ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * Self-contained hook for review feedback/notes state.
 * Reads all data directly from the review store.
 */
export function useFeedbackPanel(): FeedbackPanelState {
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useAllHunks();
  const setReviewNotes = useReviewStore((s) => s.setReviewNotes);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);
  const resolveAnnotation = useReviewStore((s) => s.resolveAnnotation);
  const unresolveAnnotation = useReviewStore((s) => s.unresolveAnnotation);
  const resolveAllAnnotations = useReviewStore((s) => s.resolveAllAnnotations);
  const deleteResolvedAnnotations = useReviewStore(
    (s) => s.deleteResolvedAnnotations,
  );
  const clearFeedback = useReviewStore((s) => s.clearFeedback);
  const revealFileInTree = useReviewStore((s) => s.revealFileInTree);

  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const notes = reviewState?.notes || "";

  // Hide annotations whose lines no longer fall within any current hunk.
  // Resolved annotations are kept here: a resolved comment on a hunk that is
  // still rejected is the rationale for that rejection and must survive into
  // the export. The annotations stay in the persisted review state so they
  // survive temporary hunk changes (rebases, resets, amends) and reappear if
  // the matching hunks come back.
  const annotations = useMemo(() => {
    const all = reviewState?.annotations ?? [];
    if (hunks.length === 0) return all;
    return all.filter(
      (a) => a.side === "file" || hunks.some((h) => isAnnotationInHunk(a, h)),
    );
  }, [reviewState?.annotations, hunks]);

  const rejectedHunks = useMemo((): RejectedHunkWithAnnotations[] => {
    if (!reviewState) return [];
    return hunks
      .filter((h) => reviewState.hunks[h.id]?.status?.value === "rejected")
      .map((h) => ({
        filePath: h.filePath,
        lineRange: hunkLineRange(h),
        hunkId: h.id,
        annotations: annotations.filter((a) => isAnnotationInHunk(a, h)),
      }));
  }, [hunks, reviewState, annotations]);

  // Standalone comments are the "still needs attention" queue — resolved ones
  // drop off here (unlike rejected-hunk comments, which stay as rationale).
  const standaloneAnnotations = useMemo(() => {
    const coveredIds = new Set(
      rejectedHunks.flatMap((rh) => rh.annotations.map((a) => a.id)),
    );
    return annotations.filter((a) => !coveredIds.has(a.id) && !a.resolvedAt);
  }, [rejectedHunks, annotations]);

  // Every unresolved comment — the Comments panel shows them all in one flat
  // list. Derived from the raw annotation set (not the hunk-filtered view)
  // so an open comment whose line has rebased out of the diff stays reachable,
  // matching how `resolvedAnnotations` is derived.
  const openComments = useMemo(() => {
    return (reviewState?.annotations ?? [])
      .filter((a) => !a.resolvedAt)
      .sort(byLocation);
  }, [reviewState?.annotations]);

  // All resolved comments, regardless of hunk coverage — surfaced in their
  // own panel subsection so a resolved comment on a file that has left the
  // diff is still reachable (to unresolve or delete) without the CLI.
  const resolvedAnnotations = useMemo(() => {
    return (reviewState?.annotations ?? [])
      .filter((a) => a.resolvedAt)
      .sort(byLocation);
  }, [reviewState?.annotations]);

  const progress = useMemo(
    () => computeReviewProgress(hunks, reviewState ?? null),
    [hunks, reviewState],
  );

  const annotationCount = reviewState?.annotations?.length ?? 0;

  // The Notes "Clear" action wipes notes + the user's own unresolved UI
  // comments only — so it's enabled exactly when one of those exists, not
  // whenever any annotation (resolved / agent / imported) is present.
  const hasClearableFeedback =
    notes.trim().length > 0 ||
    (reviewState?.annotations ?? []).some(
      (a) => !a.resolvedAt && a.source === "ui",
    );

  // The review has content worth copying/submitting once any review state
  // exists — trusted hunks count (trust-listing is a legitimate way to
  // complete a review), as do approvals, rejections, saves, comments, notes.
  const hasReviewContent =
    progress.reviewedHunks > 0 ||
    progress.savedForLaterHunks > 0 ||
    annotationCount > 0 ||
    notes.trim().length > 0;

  const copyReviewToClipboard = useCallback(async () => {
    const markdown = generateReviewMarkdown(
      reviewState?.comparison ?? null,
      progress,
      rejectedHunks,
      standaloneAnnotations,
      notes,
    );
    try {
      await getPlatformServices().clipboard.writeText(markdown);
    } catch (err) {
      // Clipboard can reject (denied permission, non-secure context, focus
      // loss). Don't leave it as an unhandled rejection or flash "Copied".
      console.error("Failed to copy review to clipboard:", err);
      return;
    }
    setCopied(true);
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [
    reviewState?.comparison,
    progress,
    rejectedHunks,
    standaloneAnnotations,
    notes,
  ]);

  return {
    notes,
    openComments,
    resolvedAnnotations,
    standaloneAnnotations,
    setReviewNotes,
    deleteAnnotation,
    resolveAnnotation,
    unresolveAnnotation,
    resolveAllAnnotations,
    deleteResolvedAnnotations,
    hasClearableFeedback,
    hasReviewContent,
    progress,
    goToFile: revealFileInTree,
    rejectedHunks,
    copied,
    copyReviewToClipboard,
    clearFeedback,
  };
}
