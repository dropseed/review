import { useEffect, useRef } from "react";
import { File as PierreFile } from "@pierre/diffs/react";
import { detectLanguage } from "./languageMap";

interface PlainCodeViewProps {
  content: string;
  filePath: string;
  highlightLine?: number | null;
  theme: string;
  fontSizeCSS: string;
}

export function PlainCodeView({
  content,
  filePath,
  highlightLine,
  theme,
  fontSizeCSS,
}: PlainCodeViewProps) {
  const language = detectLanguage(filePath, content);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted line when it changes
  useEffect(() => {
    if (highlightLine && containerRef.current) {
      // Wait for render, then scroll to the line
      const timeout = setTimeout(() => {
        const lineEl = containerRef.current?.querySelector(
          `[data-line="${highlightLine}"]`,
        );
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100); // Small delay to ensure content is rendered
      return () => clearTimeout(timeout);
    }
  }, [highlightLine]);

  return (
    <div ref={containerRef}>
      <PierreFile
        file={{
          name: filePath,
          contents: content,
          lang: language,
        }}
        selectedLines={
          highlightLine
            ? { start: highlightLine, end: highlightLine, side: "additions" }
            : null
        }
        options={{
          theme: {
            dark: theme,
            light: theme,
          },
          themeType: "dark",
          disableFileHeader: true,
          unsafeCSS: fontSizeCSS,
        }}
      />
    </div>
  );
}
