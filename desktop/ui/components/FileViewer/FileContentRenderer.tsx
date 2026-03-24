import { memo } from "react";
import type { LineAnnotation, FileContent } from "../../types";
import type { SupportedLanguages } from "./languageMap";
import { isMarkdownFile } from "./languageMap";
import { PlainCodeView } from "./PlainCodeView";
import { DiffView, DiffErrorBoundary } from "./DiffView";
import { ImageViewer } from "./ImageViewer";
import { MarkdownViewer } from "./MarkdownViewer";
import type { ContentMode } from "./content-mode";

interface FileContentRendererProps {
  filePath: string;
  fileContent: FileContent;
  contentMode: ContentMode;
  codeTheme: string;
  fontCSS: string;
  effectiveLanguage: SupportedLanguages | undefined;
  markdownViewMode: "preview" | "code";
  highlightLine: number | null;
  lineHeight: number;
  onViewInFile: (line: number) => void;
  annotations: LineAnnotation[] | undefined;
  addAnnotation: (
    filePath: string,
    lineNumber: number,
    side: "old" | "new" | "file",
    content: string,
  ) => void;
  updateAnnotation: (id: string, content: string) => void;
  deleteAnnotation: (id: string) => void;
  onNavigateToFile?: (
    repoRelativePath: string,
    options?: { openInSplit?: boolean },
  ) => void;
}

export const FileContentRenderer = memo(function FileContentRenderer({
  filePath,
  fileContent,
  contentMode,
  codeTheme,
  fontCSS,
  effectiveLanguage,
  markdownViewMode,
  highlightLine,
  lineHeight,
  onViewInFile,
  annotations: fileAnnotations,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  onNavigateToFile,
}: FileContentRendererProps) {
  // Markdown preview mode
  if (isMarkdownFile(filePath) && markdownViewMode === "preview") {
    return (
      <MarkdownViewer
        content={fileContent.content}
        filePath={filePath}
        onNavigateToFile={onNavigateToFile}
      />
    );
  }

  switch (contentMode.type) {
    case "image":
      if (!fileContent.imageDataUrl) return null;
      return (
        <ImageViewer
          imageDataUrl={fileContent.imageDataUrl}
          oldImageDataUrl={fileContent.oldImageDataUrl}
          filePath={filePath}
          hasChanges={fileContent.hunks.length > 0}
        />
      );

    case "diff": {
      const { viewMode } = contentMode;

      // Old/New file view modes - show file content with subtle diff highlighting
      if (viewMode === "old" || viewMode === "new") {
        const isOldMode = viewMode === "old";
        const content = isOldMode
          ? fileContent.oldContent
          : fileContent.content;

        // Handle missing content (new file in old mode, deleted file in new mode)
        if (!content) {
          const message = isOldMode
            ? {
                title: "No previous version",
                detail: "This file was added in this change",
              }
            : {
                title: "File deleted",
                detail: "This file was removed in this change",
              };

          return (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="text-center">
                <p className="text-fg-muted">{message.title}</p>
                <p className="mt-1 text-sm text-fg-faint">{message.detail}</p>
              </div>
            </div>
          );
        }

        return (
          <DiffErrorBoundary
            key={filePath}
            fallback={<RenderErrorFallback filePath={filePath} />}
          >
            <PlainCodeView
              content={content}
              filePath={filePath}
              highlightLine={highlightLine}
              theme={codeTheme}
              fontCSS={fontCSS}
              language={effectiveLanguage}
              lineHeight={lineHeight}
              annotations={fileAnnotations}
              onAddAnnotation={(lineNumber, content) =>
                addAnnotation(filePath, lineNumber, "file", content)
              }
              onUpdateAnnotation={updateAnnotation}
              onDeleteAnnotation={deleteAnnotation}
              extraCSS={buildDiffHighlightCSS(fileContent, viewMode)}
            />
          </DiffErrorBoundary>
        );
      }

      // Diff view (unified or split)
      // For large files, collapse unchanged sections to improve performance.
      // Users can expand sections on demand via the expand buttons.
      const totalLines =
        (fileContent.oldContent?.split("\n").length ?? 0) +
        (fileContent.content?.split("\n").length ?? 0);
      const expandUnchanged = totalLines <= 2500;

      return (
        <DiffView
          diffPatch={fileContent.diffPatch}
          viewMode={viewMode}
          hunks={fileContent.hunks}
          theme={codeTheme}
          fontCSS={fontCSS}
          onViewInFile={onViewInFile}
          fileName={filePath}
          oldContent={fileContent.oldContent}
          newContent={fileContent.content}
          language={effectiveLanguage}
          expandUnchanged={expandUnchanged}
          highlightLine={highlightLine}
          lineHeight={lineHeight}
        />
      );
    }

    case "svg":
    case "plain":
      // Plain code view (file view mode, or files without changes)
      return (
        <DiffErrorBoundary
          key={filePath}
          fallback={<RenderErrorFallback filePath={filePath} />}
        >
          <PlainCodeView
            content={fileContent.content}
            filePath={filePath}
            highlightLine={highlightLine}
            theme={codeTheme}
            fontCSS={fontCSS}
            language={effectiveLanguage}
            lineHeight={lineHeight}
            annotations={fileAnnotations}
            onAddAnnotation={(lineNumber, content) =>
              addAnnotation(filePath, lineNumber, "file", content)
            }
            onUpdateAnnotation={updateAnnotation}
            onDeleteAnnotation={deleteAnnotation}
          />
        </DiffErrorBoundary>
      );
  }
});

/** Builds unsafeCSS to highlight added/removed lines in old/new file view */
function buildDiffHighlightCSS(
  fileContent: FileContent,
  viewMode: "old" | "new",
): string {
  const isOldMode = viewMode === "old";
  const lineType = isOldMode ? "removed" : "added";
  const lineNumberKey = isOldMode ? "oldLineNumber" : "newLineNumber";

  const lineNumbers: number[] = [];
  for (const hunk of fileContent.hunks) {
    for (const line of hunk.lines) {
      if (line.type === lineType && line[lineNumberKey] != null) {
        lineNumbers.push(line[lineNumberKey]);
      }
    }
  }

  if (lineNumbers.length === 0) return "";

  const selectors = lineNumbers.map((n) => `[data-line="${n}"]`).join(", ");

  // Match pierre's bars indicator style: a 4px bar on the left of the line number column
  // Additions get a solid bar, deletions get a hatched/striped bar
  const barCSS = isOldMode
    ? `background-image: linear-gradient(0deg, var(--diffs-bg-deletion) 50%, var(--diffs-deletion-base) 50%);
  background-repeat: repeat;
  background-size: 2px 2px;
  background-size: calc(1lh / round(1lh / 2px)) calc(1lh / round(1lh / 2px));`
    : `background-color: var(--diffs-addition-base);`;

  return `
:is(${selectors}) > [data-column-number] {
  position: relative;
}
:is(${selectors}) > [data-column-number]::before {
  content: '';
  display: block;
  width: 4px;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  user-select: none;
  contain: layout paint;
  ${barCSS}
}
`;
}

function RenderErrorFallback({ filePath }: { filePath: string }) {
  return (
    <div className="p-6">
      <div className="rounded-lg bg-status-rejected/10 border border-status-rejected/20 p-4">
        <p className="text-status-rejected">Failed to render file view</p>
        <p className="mt-1 text-sm text-fg-muted">{filePath}</p>
      </div>
    </div>
  );
}
