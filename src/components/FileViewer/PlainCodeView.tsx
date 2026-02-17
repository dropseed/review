import { useEffect, useRef, useState, useMemo } from "react";
import { File as PierreFile } from "@pierre/diffs/react";
import type { LineAnnotation as PierreLineAnnotation } from "@pierre/diffs/react";
import type { LineAnnotation } from "../../types";
import {
  AnnotationEditor,
  AnnotationDisplay,
} from "./annotations/AnnotationEditor";
import type { SupportedLanguages } from "./languageMap";
import { SimpleTooltip } from "../ui/tooltip";

// Metadata for annotations in file view
type FileAnnotationMeta =
  | { type: "user"; data: { annotation: LineAnnotation } }
  | { type: "new"; data: Record<string, never> };

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
  /** Annotations for this file */
  annotations?: LineAnnotation[];
  /** Callback when adding a new annotation */
  onAddAnnotation?: (lineNumber: number, content: string) => void;
  /** Callback when updating an annotation */
  onUpdateAnnotation?: (id: string, content: string) => void;
  /** Callback when deleting an annotation */
  onDeleteAnnotation?: (id: string) => void;
}

export function PlainCodeView({
  content,
  filePath,
  highlightLine,
  theme,
  fontSizeCSS,
  language,
  lineHeight = 21,
  annotations = [],
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
}: PlainCodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // State for new annotation editor
  const [newAnnotationLine, setNewAnnotationLine] = useState<number | null>(
    null,
  );
  // State for editing existing annotation
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(
    null,
  );

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

  // Filter annotations that are for file view (side === "file")
  const fileAnnotations = useMemo(() => {
    return annotations.filter((a) => a.side === "file");
  }, [annotations]);

  // Build line annotations for PierreFile
  // PierreFile uses LineAnnotation (without side) not DiffLineAnnotation
  const lineAnnotations: PierreLineAnnotation<FileAnnotationMeta>[] =
    useMemo(() => {
      const items: PierreLineAnnotation<FileAnnotationMeta>[] = [];

      // Add existing annotations
      for (const annotation of fileAnnotations) {
        items.push({
          lineNumber: annotation.lineNumber,
          metadata: { type: "user", data: { annotation } },
        });
      }

      // Add new annotation editor if active
      if (newAnnotationLine !== null) {
        items.push({
          lineNumber: newAnnotationLine,
          metadata: { type: "new", data: {} },
        });
      }

      return items;
    }, [fileAnnotations, newAnnotationLine]);

  // Handle saving a new annotation
  const handleSaveNewAnnotation = (annotationContent: string) => {
    if (newAnnotationLine === null || !onAddAnnotation) return;
    onAddAnnotation(newAnnotationLine, annotationContent);
    setNewAnnotationLine(null);
  };

  // Render annotation based on type
  const renderAnnotation = (
    annotation: PierreLineAnnotation<FileAnnotationMeta>,
  ) => {
    const meta = annotation.metadata!;

    // Handle new annotation editor
    if (meta.type === "new") {
      return (
        <AnnotationEditor
          onSave={handleSaveNewAnnotation}
          onCancel={() => setNewAnnotationLine(null)}
          autoFocus
        />
      );
    }

    // Handle user annotations
    const { annotation: userAnnotation } = meta.data;
    const isEditing = editingAnnotationId === userAnnotation.id;

    if (isEditing) {
      return (
        <AnnotationEditor
          initialContent={userAnnotation.content}
          onSave={(annotationContent) => {
            onUpdateAnnotation?.(userAnnotation.id, annotationContent);
            setEditingAnnotationId(null);
          }}
          onCancel={() => setEditingAnnotationId(null)}
          onDelete={() => {
            onDeleteAnnotation?.(userAnnotation.id);
            setEditingAnnotationId(null);
          }}
          autoFocus
        />
      );
    }

    return (
      <AnnotationDisplay
        annotation={userAnnotation}
        onEdit={() => setEditingAnnotationId(userAnnotation.id)}
        onDelete={() => onDeleteAnnotation?.(userAnnotation.id)}
      />
    );
  };

  // Render hover utility for adding annotations
  // For file view, the callback returns { lineNumber } without side
  // Always render the button — the shadow DOM controls visibility by
  // moving the slot container to the hovered line.
  const renderHoverUtility = (
    getHoveredLine: () => { lineNumber: number } | undefined,
  ) => {
    if (!onAddAnnotation) return null;

    return (
      <SimpleTooltip content="Add comment">
        <button
          className="flex h-5 w-5 items-center justify-center rounded bg-status-renamed/80 text-surface shadow-lg transition-colors hover:bg-status-renamed hover:scale-110"
          onClick={() => {
            const hoveredLine = getHoveredLine();
            if (!hoveredLine) return;
            setNewAnnotationLine(hoveredLine.lineNumber);
          }}
          aria-label="Add comment"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </button>
      </SimpleTooltip>
    );
  };

  return (
    <div ref={containerRef}>
      <PierreFile
        file={{
          name: filePath,
          contents: content,
          lang: language,
          cacheKey: `file:${filePath}:${content.length}`,
        }}
        selectedLines={
          highlightLine
            ? { start: highlightLine, end: highlightLine, side: "additions" }
            : null
        }
        lineAnnotations={lineAnnotations}
        renderAnnotation={renderAnnotation}
        renderHoverUtility={renderHoverUtility}
        options={{
          theme: {
            dark: theme,
            light: theme,
          },
          themeType: "dark",
          disableFileHeader: true,
          unsafeCSS: fontSizeCSS,
          enableHoverUtility: true,
        }}
      />
    </div>
  );
}
