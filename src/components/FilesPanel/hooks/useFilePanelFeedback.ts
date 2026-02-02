import { useState, useMemo, useCallback } from "react";
import { useReviewStore } from "../../../stores";
import { getPlatformServices } from "../../../platform";
import type { ReviewState, DiffHunk, LineAnnotation } from "../../../types";

interface UseFilePanelFeedbackOptions {
  reviewState: ReviewState | null;
  rejectedCount: number;
  hunks: DiffHunk[];
}

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

  // Changes Requested section
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

  // Annotations section (only those NOT already shown under a rejected hunk)
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

  // Review Notes section
  if (notes.trim()) {
    lines.push("## Review Notes");
    lines.push("");
    lines.push(notes.trim());
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Manages feedback panel state (notes + annotations + copy to clipboard).
 */
export function useFilePanelFeedback({
  reviewState,
  rejectedCount,
  hunks,
}: UseFilePanelFeedbackOptions) {
  const { setReviewNotes, deleteAnnotation, revealFileInTree } =
    useReviewStore();

  const [feedbackOpen, setFeedbackOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Check if there's feedback to export
  const hasFeedbackToExport = useMemo(() => {
    const hasRejections = rejectedCount > 0;
    const hasAnnotations = (reviewState?.annotations ?? []).length > 0;
    const hasNotes = (reviewState?.notes ?? "").trim().length > 0;
    return hasRejections || hasAnnotations || hasNotes;
  }, [rejectedCount, reviewState?.annotations, reviewState?.notes]);

  const handleGoToAnnotation = useCallback(
    (annotation: { filePath: string }) => {
      revealFileInTree(annotation.filePath);
    },
    [revealFileInTree],
  );

  const rejectedHunks = useMemo(() => {
    if (!reviewState) return [];
    return hunks
      .filter((h) => reviewState.hunks[h.id]?.status === "rejected")
      .map((h) => ({
        filePath: h.filePath,
        lineRange: hunkLineRange(h),
        hunkId: h.id,
      }));
  }, [hunks, reviewState]);

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
    notes: reviewState?.notes || "",
    annotations: reviewState?.annotations ?? [],
    setReviewNotes,
    deleteAnnotation,
    feedbackOpen,
    setFeedbackOpen,
    hasFeedbackToExport,
    handleGoToAnnotation,
    rejectedHunks,
    copied,
    copyFeedbackToClipboard,
  };
}
