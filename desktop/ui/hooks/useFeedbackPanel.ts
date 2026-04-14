import { useMemo, useCallback, useState } from "react";
import { useReviewStore } from "../stores";
import { useAllHunks } from "../stores/selectors/hunks";
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
 * Accepts already-grouped data to avoid re-deriving the grouping.
 */
function generateFeedbackMarkdown(
  rejectedHunks: RejectedHunkWithAnnotations[],
  standaloneAnnotations: LineAnnotation[],
  notes: string,
): string {
  const lines: string[] = [];

  lines.push("# Review Feedback");
  lines.push("");

  if (rejectedHunks.length > 0) {
    lines.push("## Changes Requested");
    lines.push("");

    for (const hunk of rejectedHunks) {
      lines.push(`- **${hunk.filePath}:${hunk.lineRange}**`);
      for (const annotation of hunk.annotations) {
        lines.push(`  - ${annotation.content}`);
      }
    }
    lines.push("");
  }

  if (standaloneAnnotations.length > 0) {
    lines.push("## Annotations");
    lines.push("");

    for (const annotation of standaloneAnnotations) {
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

export interface RejectedHunkWithAnnotations {
  filePath: string;
  lineRange: string;
  hunkId: string;
  annotations: LineAnnotation[];
}

export interface FeedbackPanelState {
  notes: string;
  standaloneAnnotations: LineAnnotation[];
  setReviewNotes: (notes: string) => void;
  deleteAnnotation: (annotationId: string) => void;
  hasFeedbackToExport: boolean;
  goToFile: (filePath: string) => void;
  rejectedHunks: RejectedHunkWithAnnotations[];
  feedbackCount: number;
  copied: boolean;
  copyFeedbackToClipboard: () => Promise<void>;
  clearFeedback: () => void;
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
  const clearFeedback = useReviewStore((s) => s.clearFeedback);
  const revealFileInTree = useReviewStore((s) => s.revealFileInTree);

  const [copied, setCopied] = useState(false);

  const notes = reviewState?.notes || "";

  // Hide annotations whose lines no longer fall within any current hunk.
  // The annotations stay in the persisted review state so they survive
  // temporary hunk changes (rebases, resets, amends) and reappear if the
  // matching hunks come back.
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
      .filter((h) => reviewState.hunks[h.id]?.status === "rejected")
      .map((h) => ({
        filePath: h.filePath,
        lineRange: hunkLineRange(h),
        hunkId: h.id,
        annotations: annotations.filter((a) => isAnnotationInHunk(a, h)),
      }));
  }, [hunks, reviewState, annotations]);

  const standaloneAnnotations = useMemo(() => {
    const coveredIds = new Set(
      rejectedHunks.flatMap((rh) => rh.annotations.map((a) => a.id)),
    );
    return annotations.filter((a) => !coveredIds.has(a.id));
  }, [rejectedHunks, annotations]);

  const feedbackCount = rejectedHunks.length + standaloneAnnotations.length;

  const hasFeedbackToExport =
    rejectedHunks.length > 0 ||
    standaloneAnnotations.length > 0 ||
    notes.trim().length > 0;

  const copyFeedbackToClipboard = useCallback(async () => {
    const markdown = generateFeedbackMarkdown(
      rejectedHunks,
      standaloneAnnotations,
      notes,
    );
    const platform = getPlatformServices();
    await platform.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [rejectedHunks, standaloneAnnotations, notes]);

  return {
    notes,
    standaloneAnnotations,
    setReviewNotes,
    deleteAnnotation,
    hasFeedbackToExport,
    goToFile: revealFileInTree,
    rejectedHunks,
    feedbackCount,
    copied,
    copyFeedbackToClipboard,
    clearFeedback,
  };
}
