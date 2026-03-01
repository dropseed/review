import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import type { Components } from "react-markdown";
import { MermaidDiagram } from "./MermaidDiagram";
import { getPlatformServices } from "../../../platform";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const components: Components = {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match?.[1];
      const codeString = String(children).replace(/\n$/, "");

      // Render mermaid diagrams
      if (language === "mermaid") {
        return <MermaidDiagram code={codeString} />;
      }

      // Inline code
      if (!className) {
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
          className={`markdown-block-code block overflow-x-auto rounded-lg p-4 font-mono text-sm ${className}`}
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
    // Open external links in system browser instead of navigating the webview
    a({ href, children }: { href?: string; children?: ReactNode }) {
      if (href?.startsWith("#")) {
        return <a href={href}>{children}</a>;
      }
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) getPlatformServices().opener.openUrl(href);
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
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
