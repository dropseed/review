import { useState, useMemo, useCallback } from "react";
import { useReviewStore } from "../stores";
import { getPlatformServices } from "../platform";
import type { DiffHunk, LineAnnotation } from "../types";

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

/**
 * Generates feedback markdown for clipboard export.
 * Format: bullets with file:line references (no diff code blocks).
 * Rejected hunks include matching annotations as sub-bullets.
 */
function generateFeedbackMarkdown(
  hunks: DiffHunk[],
  hunkStates: Record<string, { status?: string }>,
  annotations: LineAnnotation[],
  notes: string,
): string {
  const rejectedHunks = hunks.filter(
    (h) => hunkStates[h.id]?.status === "rejected",
  );

  const lines: string[] = [];

  lines.push("# Review Feedback");
  lines.push("");

  if (rejectedHunks.length > 0) {
    lines.push("## Changes Requested");
    lines.push("");

    for (const hunk of rejectedHunks) {
      lines.push(`- **${hunk.filePath}:${hunkLineRange(hunk)}**`);

      const hunkAnnotations = annotations.filter((a) =>
        isAnnotationInHunk(a, hunk),
      );
      for (const annotation of hunkAnnotations) {
        lines.push(`  - ${annotation.content}`);
      }
    }
    lines.push("");
  }

  // Annotations not already shown under a rejected hunk
  const annotationIdsInRejectedHunks = new Set<string>();
  for (const hunk of rejectedHunks) {
    for (const a of annotations) {
      if (isAnnotationInHunk(a, hunk)) {
        annotationIdsInRejectedHunks.add(a.id);
      }
    }
  }
  const remainingAnnotations = annotations.filter(
    (a) => !annotationIdsInRejectedHunks.has(a.id),
  );

  if (remainingAnnotations.length > 0) {
    lines.push("## Annotations");
    lines.push("");

    for (const annotation of remainingAnnotations) {
      const lineRef = annotation.endLineNumber
        ? `${annotation.lineNumber}-${annotation.endLineNumber}`
        : `${annotation.lineNumber}`;
      lines.push(
        `- **${annotation.filePath}:${lineRef}** — ${annotation.content}`,
      );
    }
    lines.push("");
  }

  if (notes.trim()) {
    lines.push("## Review Notes");
    lines.push("");
    lines.push(notes.trim());
    lines.push("");
  }

  return lines.join("\n");
}

export interface RejectedHunkItem {
  filePath: string;
  lineRange: string;
  hunkId: string;
}

export interface FeedbackPanelState {
  notes: string;
  annotations: LineAnnotation[];
  setReviewNotes: (notes: string) => void;
  deleteAnnotation: (annotationId: string) => void;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  hasFeedbackToExport: boolean;
  goToFile: (filePath: string) => void;
  rejectedHunks: RejectedHunkItem[];
  feedbackCount: number;
  copied: boolean;
  copyFeedbackToClipboard: () => Promise<void>;
  clearFeedback: () => void;
}

/**
 * Self-contained hook for the floating feedback panel.
 * Reads all data directly from the review store.
 */
export function useFeedbackPanel(): FeedbackPanelState {
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useReviewStore((s) => s.hunks);
  const setReviewNotes = useReviewStore((s) => s.setReviewNotes);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);
  const clearFeedback = useReviewStore((s) => s.clearFeedback);
  const revealFileInTree = useReviewStore((s) => s.revealFileInTree);

  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const annotations = reviewState?.annotations ?? [];
  const notes = reviewState?.notes || "";

  const rejectedHunks = useMemo((): RejectedHunkItem[] => {
    if (!reviewState) return [];
    return hunks
      .filter((h) => reviewState.hunks[h.id]?.status === "rejected")
      .map((h) => ({
        filePath: h.filePath,
        lineRange: hunkLineRange(h),
        hunkId: h.id,
      }));
  }, [hunks, reviewState]);

  const feedbackCount = rejectedHunks.length + annotations.length;

  const hasFeedbackToExport =
    rejectedHunks.length > 0 ||
    annotations.length > 0 ||
    notes.trim().length > 0;

  const goToFile = useCallback(
    (filePath: string) => {
      revealFileInTree(filePath);
    },
    [revealFileInTree],
  );

  const copyFeedbackToClipboard = useCallback(async () => {
    if (!reviewState) return;
    const markdown = generateFeedbackMarkdown(
      hunks,
      reviewState.hunks,
      reviewState.annotations ?? [],
      reviewState.notes,
    );
    const platform = getPlatformServices();
    await platform.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [reviewState, hunks]);

  return {
    notes,
    annotations,
    setReviewNotes,
    deleteAnnotation,
    isExpanded,
    setIsExpanded,
    hasFeedbackToExport,
    goToFile,
    rejectedHunks,
    feedbackCount,
    copied,
    copyFeedbackToClipboard,
    clearFeedback,
  };
}
