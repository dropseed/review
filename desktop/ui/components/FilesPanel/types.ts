import type { FileEntry } from "../../types";
import type { FileHunkStatus } from "../tree/types";

export type { FileHunkStatus } from "../tree/types";

export type FilesPanelTab = "changes" | "browse" | "commits" | "search" | "git";

export interface ProcessedFileEntry extends FileEntry {
  hunkStatus: FileHunkStatus;
  hasChanges: boolean;
  matchesFilter: boolean;
  children?: ProcessedFileEntry[];
  displayName: string;
  compactedPaths: string[];
  fileCount: number;
  siblingMaxFileCount: number;
  totalSize: number;
  siblingMaxSize: number;
  latestModified: number;
}
