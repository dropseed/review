import type { StateCreator } from "zustand";
import type {
  Comparison,
  FileEntry,
  FileContent,
  DiffHunk,
  ReviewState,
  ReviewSummary,
  MovePair,
  RejectionFeedback,
  LineAnnotation,
  GitStatusSummary,
  CommitEntry,
  FileSymbolDiff,
} from "../types";
import type { ApiClient } from "../api";
import type { StorageService } from "../platform";

// Re-export types used by slices
export type {
  Comparison,
  FileEntry,
  FileContent,
  DiffHunk,
  ReviewState,
  ReviewSummary,
  MovePair,
  RejectionFeedback,
  LineAnnotation,
  GitStatusSummary,
  CommitEntry,
  FileSymbolDiff,
};

// Import all slice types
import type { PreferencesSlice } from "./slices/preferencesSlice";
import type { NavigationSlice } from "./slices/navigationSlice";
import type { GitSlice } from "./slices/gitSlice";
import type { ClassificationSlice } from "./slices/classificationSlice";
import type { FilesSlice } from "./slices/filesSlice";
import type { ReviewSlice } from "./slices/reviewSlice";
import type { SearchSlice } from "./slices/searchSlice";
import type { HistorySlice } from "./slices/historySlice";
import type { SymbolsSlice } from "./slices/symbolsSlice";

// Combined store type
export type ReviewStore = PreferencesSlice &
  NavigationSlice &
  GitSlice &
  ClassificationSlice &
  FilesSlice &
  ReviewSlice &
  SearchSlice &
  HistorySlice &
  SymbolsSlice;

// Helper type for creating slices (no dependencies)
export type SliceCreator<T> = StateCreator<ReviewStore, [], [], T>;

// Helper type for creating slices with API client
export type SliceCreatorWithClient<T> = (
  client: ApiClient,
) => StateCreator<ReviewStore, [], [], T>;

// Helper type for creating slices with storage service
export type SliceCreatorWithStorage<T> = (
  storage: StorageService,
) => StateCreator<ReviewStore, [], [], T>;

// Debounce helper
export const createDebouncedFn = (delay: number) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (fn: () => void | Promise<void>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      Promise.resolve(fn()).catch((err) =>
        console.error("Debounced function error:", err),
      );
    }, delay);
  };
};

// Helper to get all files flattened from tree
export function flattenFiles(entries: FileEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory && entry.children) {
      result.push(...flattenFiles(entry.children));
    } else if (!entry.isDirectory) {
      result.push(entry.path);
    }
  }
  return result;
}
