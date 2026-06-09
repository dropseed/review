import { memo } from "react";
import type { FileContent } from "../../types";
import type { SupportedLanguages } from "./languageMap";
import { isMarkdownFile } from "./languageMap";
import { ImageViewer } from "./ImageViewer";
import { MarkdownViewer } from "./MarkdownViewer";
import {
  FileCodeView,
  type FileCodeViewHandle,
  type FileCodeViewContent,
} from "./FileCodeView";
import type { TokenHoverHandler, TokenClickHandler } from "./diff-model";
import type { ContentMode } from "./content-mode";

export type { TokenHoverHandler, TokenClickHandler };

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
  onNavigateToFile?: (
    repoRelativePath: string,
    options?: { openInSplit?: boolean },
  ) => void;
  onTokenEnter?: TokenHoverHandler;
  onTokenLeave?: TokenHoverHandler;
  onTokenClick?: TokenClickHandler;
  /** Receives the code scroll container (null for non-code content modes) */
  containerRef?: (node: HTMLDivElement | null) => void;
  /** Imperative scroll API of the rendered CodeView */
  handleRef?: React.Ref<FileCodeViewHandle>;
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
  onNavigateToFile,
  onTokenEnter,
  onTokenLeave,
  onTokenClick,
  containerRef,
  handleRef,
}: FileContentRendererProps) {
  // Markdown preview mode
  if (isMarkdownFile(filePath) && markdownViewMode === "preview") {
    return (
      <div className="min-w-0 flex-1 h-full overflow-auto scrollbar-thin bg-surface-panel">
        <MarkdownViewer
          content={fileContent.content}
          filePath={filePath}
          onNavigateToFile={onNavigateToFile}
        />
      </div>
    );
  }

  const renderCodeView = (content: FileCodeViewContent) => (
    <FileCodeView
      filePath={filePath}
      content={content}
      theme={codeTheme}
      fontCSS={fontCSS}
      language={effectiveLanguage}
      lineHeight={lineHeight}
      highlightLine={highlightLine}
      onViewInFile={onViewInFile}
      onTokenEnter={onTokenEnter}
      onTokenLeave={onTokenLeave}
      onTokenClick={onTokenClick}
      containerRef={containerRef}
      handleRef={handleRef}
    />
  );

  switch (contentMode.type) {
    case "image":
      if (!fileContent.imageDataUrl) return null;
      return (
        <div className="min-w-0 flex-1 h-full overflow-auto scrollbar-thin bg-surface-panel">
          <ImageViewer
            imageDataUrl={fileContent.imageDataUrl}
            oldImageDataUrl={fileContent.oldImageDataUrl}
            filePath={filePath}
            hasChanges={fileContent.hunks.length > 0}
          />
        </div>
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

        return renderCodeView({
          kind: "plain",
          content,
          extraCSS: buildDiffHighlightCSS(fileContent, viewMode),
        });
      }

      // Diff view (unified or split)
      // For large files, collapse unchanged sections to improve performance.
      // Users can expand sections on demand via the expand buttons.
      const totalLines =
        (fileContent.oldContent?.split("\n").length ?? 0) +
        (fileContent.content?.split("\n").length ?? 0);
      const expandUnchanged = totalLines <= 2500;

      return renderCodeView({
        kind: "diff",
        diffPatch: fileContent.diffPatch,
        hunks: fileContent.hunks,
        oldContent: fileContent.oldContent,
        newContent: fileContent.content,
        viewMode,
        expandUnchanged,
      });
    }

    case "svg":
    case "plain":
      // Plain code view (file view mode, or files without changes)
      return renderCodeView({ kind: "plain", content: fileContent.content });
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
