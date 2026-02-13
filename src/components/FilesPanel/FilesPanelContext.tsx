import { createContext, use } from "react";
import type { FileSymbolDiff } from "../../types";
import type { FileHunkStatus } from "./types";

interface FilesPanelContextValue {
  expandedPaths: Set<string>;
  togglePath: (path: string, isGitignored?: boolean) => void;
  selectedFile: string | null;
  handleSelectFile: (path: string) => void;
  repoPath: string | null;
  revealLabel: string;
  openInSplit: (filePath: string) => void;
  registerRef: (path: string, el: HTMLButtonElement | null) => void;
  handleApproveAll: (path: string, isDir: boolean) => void;
  handleUnapproveAll: (path: string, isDir: boolean) => void;
  handleRejectAll: (path: string, isDir: boolean) => void;
  movedFilePaths: Set<string>;
  hunkStatusMap: Map<string, FileHunkStatus>;
  fileStatusMap: Map<string, string>;
  symbolDiffMap: Map<string, FileSymbolDiff>;
}

const FilesPanelContext = createContext<FilesPanelContextValue | null>(null);

export const FilesPanelProvider = FilesPanelContext.Provider;

export function useFilesPanelContext(): FilesPanelContextValue {
  const ctx = use(FilesPanelContext);
  if (!ctx) {
    throw new Error(
      "useFilesPanelContext must be used within a FilesPanelProvider",
    );
  }
  return ctx;
}
