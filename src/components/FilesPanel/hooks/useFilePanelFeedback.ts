import { useState, useMemo } from "react";
import { useReviewStore } from "../../../stores/reviewStore";
import type { ReviewState } from "../../../types";

interface UseFilePanelFeedbackOptions {
  reviewState: ReviewState | null;
  rejectedCount: number;
}

/**
 * Manages feedback panel state (notes + annotations).
 * Groups: notes, annotations, setReviewNotes, deleteAnnotation
 */
export function useFilePanelFeedback({
  reviewState,
  rejectedCount,
}: UseFilePanelFeedbackOptions) {
  const { setReviewNotes, deleteAnnotation, revealFileInTree } =
    useReviewStore();

  const [notesOpen, setNotesOpen] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);

  // Check if there's feedback to export
  const hasFeedbackToExport = useMemo(() => {
    const hasRejections = rejectedCount > 0;
    const hasAnnotations = (reviewState?.annotations ?? []).length > 0;
    const hasNotes = (reviewState?.notes ?? "").trim().length > 0;
    return hasRejections || hasAnnotations || hasNotes;
  }, [rejectedCount, reviewState?.annotations, reviewState?.notes]);

  const handleGoToAnnotation = (annotation: { filePath: string }) => {
    revealFileInTree(annotation.filePath);
  };

  return {
    notes: reviewState?.notes || "",
    annotations: reviewState?.annotations ?? [],
    setReviewNotes,
    deleteAnnotation,
    notesOpen,
    setNotesOpen,
    showExportModal,
    setShowExportModal,
    hasFeedbackToExport,
    handleGoToAnnotation,
  };
}
