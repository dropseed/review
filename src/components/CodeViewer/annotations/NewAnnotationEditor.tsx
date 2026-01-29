import { AnnotationEditor } from "../AnnotationEditor";

interface NewAnnotationEditorProps {
  onSave: (content: string) => void;
  onCancel: () => void;
}

export function NewAnnotationEditor({
  onSave,
  onCancel,
}: NewAnnotationEditorProps) {
  return <AnnotationEditor onSave={onSave} onCancel={onCancel} autoFocus />;
}
