import type { FileEntry } from "../../types";

export type FilesPanelTab = "changes" | "browse" | "commits" | "search" | "git";

// Hunk status for a file
export interface FileHunkStatus {
  pending: number;
  approved: number;
  trusted: number;
  rejected: number;
  savedForLater: number;
  total: number;
}

// Extended FileEntry with review status
export interface ProcessedFileEntry extends FileEntry {
  hunkStatus: FileHunkStatus;
  hasChanges: boolean;
  matchesFilter: boolean;
  children?: ProcessedFileEntry[];
  displayName: string;
  compactedPaths: string[];
  fileCount: number;
  siblingMaxFileCount: number;
}
