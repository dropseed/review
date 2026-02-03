import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { MermaidDiagram } from "./MermaidDiagram";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const components: Components = {
    // Handle code blocks - detect mermaid language
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
  };

  return (
    <div className="markdown-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
