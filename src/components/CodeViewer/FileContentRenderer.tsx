import type { FileContent, ReviewState } from "../../types";
import type { SupportedLanguages } from "./languageMap";
import { isMarkdownFile } from "./languageMap";
import { PlainCodeView } from "./PlainCodeView";
import { UntrackedFileView } from "./UntrackedFileView";
import { DiffView } from "./DiffView";
import { ImageViewer } from "./ImageViewer";
import { MarkdownViewer } from "./MarkdownViewer";

interface FileContentRendererProps {
  filePath: string;
  fileContent: FileContent;
  viewMode: "unified" | "split";
  codeTheme: string;
  fontSizeCSS: string;
  focusedHunkId: string | null;
  effectiveLanguage: SupportedLanguages | undefined;
  markdownViewMode: "preview" | "code";
  svgViewMode: "rendered" | "code";
  showImageViewer: boolean;
  isUntracked: boolean;
  hasChanges: boolean;
  highlightLine: number | null;
  lineHeight: number;
  onViewInFile: (line: number) => void;
  reviewState: ReviewState | null;
  addAnnotation: (
    filePath: string,
    lineNumber: number,
    side: "old" | "new" | "file",
    content: string,
  ) => void;
  updateAnnotation: (id: string, content: string) => void;
  deleteAnnotation: (id: string) => void;
}

export function FileContentRenderer({
  filePath,
  fileContent,
  viewMode,
  codeTheme,
  fontSizeCSS,
  focusedHunkId,
  effectiveLanguage,
  markdownViewMode,
  showImageViewer,
  isUntracked,
  hasChanges,
  highlightLine,
  lineHeight,
  onViewInFile,
  reviewState,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
}: FileContentRendererProps) {
  // Markdown preview mode
  if (isMarkdownFile(filePath) && markdownViewMode === "preview") {
    return <MarkdownViewer content={fileContent.content} />;
  }

  // Image viewer (including rendered SVG)
  if (showImageViewer && fileContent.imageDataUrl) {
    return (
      <ImageViewer
        imageDataUrl={fileContent.imageDataUrl}
        oldImageDataUrl={fileContent.oldImageDataUrl}
        filePath={filePath}
        hasChanges={hasChanges}
      />
    );
  }

  // Untracked (new) file
  if (isUntracked) {
    return (
      <UntrackedFileView
        content={fileContent.content}
        filePath={filePath}
        hunks={fileContent.hunks}
        theme={codeTheme}
        fontSizeCSS={fontSizeCSS}
        language={effectiveLanguage}
      />
    );
  }

  // Diff view (unified or split) for files with changes
  if (hasChanges) {
    return (
      <DiffView
        diffPatch={fileContent.diffPatch}
        viewMode={viewMode}
        hunks={fileContent.hunks}
        theme={codeTheme}
        fontSizeCSS={fontSizeCSS}
        onViewInFile={onViewInFile}
        fileName={filePath}
        oldContent={fileContent.oldContent}
        newContent={fileContent.content}
        focusedHunkId={focusedHunkId}
        language={effectiveLanguage}
      />
    );
  }

  // Plain code view (file view mode, or files without changes)
  return (
    <PlainCodeView
      content={fileContent.content}
      filePath={filePath}
      highlightLine={highlightLine}
      theme={codeTheme}
      fontSizeCSS={fontSizeCSS}
      language={effectiveLanguage}
      lineHeight={lineHeight}
      annotations={reviewState?.annotations?.filter(
        (a) => a.filePath === filePath,
      )}
      onAddAnnotation={(lineNumber, content) =>
        addAnnotation(filePath, lineNumber, "file", content)
      }
      onUpdateAnnotation={updateAnnotation}
      onDeleteAnnotation={deleteAnnotation}
    />
  );
}
