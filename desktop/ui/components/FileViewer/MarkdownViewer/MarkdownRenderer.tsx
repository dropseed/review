import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeSlug from "rehype-slug";
import type { Components } from "react-markdown";
import { MermaidDiagram } from "./MermaidDiagram";
import { getPlatformServices } from "../../../platform";

/** Resolve a relative href against the directory of the current file. */
function resolveRelativePath(basePath: string, href: string): string {
  const [pathPart] = href.split("#");
  const base = new URL(basePath, "file:///");
  const resolved = new URL(pathPart, base);
  return resolved.pathname.slice(1); // strip leading /
}

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Returns true for hrefs that are absolute URLs (http:, mailto:, etc.). */
function isAbsoluteUrl(href: string): boolean {
  return ABSOLUTE_URL_RE.test(href);
}

interface MarkdownRendererProps {
  content: string;
  /** Repo-relative path of the file being rendered (for resolving relative links). */
  filePath?: string;
  /** Called when a relative file link is clicked (resolved repo-relative path). */
  onNavigateToFile?: (
    repoRelativePath: string,
    options?: { openInSplit?: boolean },
  ) => void;
}

export function MarkdownRenderer({
  content,
  filePath,
  onNavigateToFile,
}: MarkdownRendererProps) {
  const components: Components = {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match?.[1];
      const codeString = String(children).replace(/\n$/, "");

      // Render mermaid diagrams
      if (language === "mermaid") {
        return <MermaidDiagram code={codeString} />;
      }

      // Inline code (no language class and single-line content)
      // Fenced code blocks without a language also lack className,
      // so check for newlines to distinguish from inline code.
      if (!className && !String(children).includes("\n")) {
        return (
          <code
            className="markdown-inline-code rounded px-1.5 py-0.5 font-mono text-sm"
            {...props}
          >
            {children}
          </code>
        );
      }

      // Code blocks
      return (
        <code
          className={`markdown-block-code block overflow-x-auto rounded-lg p-4 font-mono text-sm ${className || ""}`}
          {...props}
        >
          {children}
        </code>
      );
    },
    // Pre wrapper for code blocks
    pre({ children }) {
      return <pre className="my-4 overflow-hidden rounded-lg">{children}</pre>;
    },
    // Handle links: anchor links stay in-page, relative file links navigate
    // within the app, and external URLs open in the system browser.
    a({ href, children }: { href?: string; children?: ReactNode }) {
      if (!href) return <a>{children}</a>;

      if (href.startsWith("#")) {
        return <a href={href}>{children}</a>;
      }

      if (!isAbsoluteUrl(href) && filePath && onNavigateToFile) {
        const resolved = resolveRelativePath(filePath, href);
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onNavigateToFile(resolved, { openInSplit: e.metaKey });
            }}
          >
            {children}
          </a>
        );
      }

      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            getPlatformServices().opener.openUrl(href);
          }}
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },
  };

  return (
    <div className="markdown-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter]}
        rehypePlugins={[rehypeSlug]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
