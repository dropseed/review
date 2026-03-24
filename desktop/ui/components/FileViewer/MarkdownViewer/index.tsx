import { useMemo } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FrontmatterCard } from "./FrontmatterCard";
import { parseFrontmatter } from "./parseFrontmatter";

interface MarkdownViewerProps {
  content: string;
  /** Repo-relative path of the file being rendered (for resolving relative links). */
  filePath?: string;
  /** Called when a relative file link is clicked (resolved repo-relative path). */
  onNavigateToFile?: (
    repoRelativePath: string,
    options?: { openInSplit?: boolean },
  ) => void;
}

export function MarkdownViewer({
  content,
  filePath,
  onNavigateToFile,
}: MarkdownViewerProps) {
  const {
    frontmatter,
    content: body,
    hasFrontmatter,
  } = useMemo(() => parseFrontmatter(content), [content]);

  return (
    <div className="h-full overflow-auto p-6 scrollbar-thin">
      <div className="mx-auto max-w-4xl">
        {hasFrontmatter && <FrontmatterCard data={frontmatter} />}
        <MarkdownRenderer
          content={body}
          filePath={filePath}
          onNavigateToFile={onNavigateToFile}
        />
      </div>
    </div>
  );
}
