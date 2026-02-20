import { MarkdownRenderer } from "./MarkdownRenderer";

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div className="h-full overflow-auto p-6 scrollbar-thin">
      <div className="mx-auto max-w-4xl">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}
