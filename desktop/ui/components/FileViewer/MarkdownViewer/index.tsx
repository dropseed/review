import { useMemo } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FrontmatterCard } from "./FrontmatterCard";
import { parseFrontmatter } from "./parseFrontmatter";

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  const {
    frontmatter,
    content: body,
    hasFrontmatter,
  } = useMemo(() => parseFrontmatter(content), [content]);

  return (
    <div className="h-full overflow-auto p-6 scrollbar-thin">
      <div className="mx-auto max-w-4xl">
        {hasFrontmatter && <FrontmatterCard data={frontmatter} />}
        <MarkdownRenderer content={body} />
      </div>
    </div>
  );
}
