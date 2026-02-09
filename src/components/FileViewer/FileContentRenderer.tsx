import type { FileContent, ReviewState } from "../../types";
import type { SupportedLanguages } from "./languageMap";
import { isMarkdownFile } from "./languageMap";
import { PlainCodeView } from "./PlainCodeView";
import { UntrackedFileView } from "./UntrackedFileView";
import { DiffView, DiffErrorBoundary } from "./DiffView";
import { ImageViewer } from "./ImageViewer";
import { MarkdownViewer } from "./MarkdownViewer";

interface FileContentRendererProps {
  filePath: string;
  fileContent: FileContent;
  viewMode: "unified" | "split" | "old" | "new";
  codeTheme: string;
  fontSizeCSS: string;
  focusedHunkId: string | null;
  effectiveLanguage: SupportedLanguages | undefined;
  markdownViewMode: "preview" | "code";
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
  const fileAnnotations = reviewState?.annotations?.filter(
    (a) => a.filePath === filePath,
  );

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
      <DiffErrorBoundary
        key={filePath}
        fallback={<RenderErrorFallback filePath={filePath} />}
      >
        <UntrackedFileView
          content={fileContent.content}
          filePath={filePath}
          hunks={fileContent.hunks}
          theme={codeTheme}
          fontSizeCSS={fontSizeCSS}
          language={effectiveLanguage}
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

  // Old/New file view modes - show file content without diff highlighting
  if ((viewMode === "old" || viewMode === "new") && hasChanges) {
    const isOldMode = viewMode === "old";
    const content = isOldMode ? fileContent.oldContent : fileContent.content;

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
            <p className="text-stone-500">{message.title}</p>
            <p className="mt-1 text-sm text-stone-600">{message.detail}</p>
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
          fontSizeCSS={fontSizeCSS}
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

  // Diff view (unified or split) for files with changes
  if (hasChanges) {
    return (
      <DiffView
        diffPatch={fileContent.diffPatch}
        viewMode={viewMode as "unified" | "split"}
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
    <DiffErrorBoundary
      key={filePath}
      fallback={<RenderErrorFallback filePath={filePath} />}
    >
      <PlainCodeView
        content={fileContent.content}
        filePath={filePath}
        highlightLine={highlightLine}
        theme={codeTheme}
        fontSizeCSS={fontSizeCSS}
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

function RenderErrorFallback({ filePath }: { filePath: string }) {
  return (
    <div className="p-6">
      <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-4">
        <p className="text-rose-400">Failed to render file view</p>
        <p className="mt-1 text-sm text-stone-500">{filePath}</p>
      </div>
    </div>
  );
}
