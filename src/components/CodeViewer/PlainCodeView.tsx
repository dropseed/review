import { useEffect, useRef } from "react";
import { File as PierreFile } from "@pierre/diffs/react";
import type { SupportedLanguages } from "./languageMap";

interface PlainCodeViewProps {
  content: string;
  filePath: string;
  highlightLine?: number | null;
  theme: string;
  fontSizeCSS: string;
  /** Language override for syntax highlighting */
  language?: SupportedLanguages;
  /** Line height in pixels for scroll calculation */
  lineHeight?: number;
}

export function PlainCodeView({
  content,
  filePath,
  highlightLine,
  theme,
  fontSizeCSS,
  language,
  lineHeight = 21,
}: PlainCodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted line when it changes
  useEffect(() => {
    if (highlightLine && containerRef.current) {
      // Use requestAnimationFrame for immediate scroll after render
      const frame = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;

        // Find the scrollable parent (overflow-auto container)
        let scrollParent: HTMLElement | null = container.parentElement;
        while (scrollParent) {
          const { overflow, overflowY } = getComputedStyle(scrollParent);
          const isScrollable =
            overflow === "auto" ||
            overflow === "scroll" ||
            overflowY === "auto" ||
            overflowY === "scroll";
          if (isScrollable) break;
          scrollParent = scrollParent.parentElement;
        }

        if (scrollParent) {
          // Calculate scroll position based on line number and line height
          // Center the line in the viewport
          const targetY = (highlightLine - 1) * lineHeight;
          const centerOffset = scrollParent.clientHeight / 2;
          const scrollTo = Math.max(0, targetY - centerOffset);

          scrollParent.scrollTop = scrollTo;
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [highlightLine, lineHeight]);

  return (
    <div ref={containerRef}>
      <div key={language}>
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
    </div>
  );
}
