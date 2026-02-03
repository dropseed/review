import type { LineAnnotation } from "../../../types";
import { AnnotationEditor, AnnotationDisplay } from "./AnnotationEditor";

interface UserAnnotationDisplayProps {
  annotation: LineAnnotation;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (content: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function UserAnnotationDisplay({
  annotation,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
}: UserAnnotationDisplayProps) {
  if (isEditing) {
    return (
      <AnnotationEditor
        initialContent={annotation.content}
        onSave={onSave}
        onCancel={onCancel}
        onDelete={onDelete}
        autoFocus
      />
    );
  }

  return (
    <AnnotationDisplay
      annotation={annotation}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}
