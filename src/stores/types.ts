import type { StateCreator } from "zustand";
import type { FileEntry } from "../types";
import type { ApiClient } from "../api";
import type { StorageService } from "../platform";

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
import type { GroupingSlice } from "./slices/groupingSlice";
import type { UndoSlice } from "./slices/undoSlice";
import type { GlobalReviewsSlice } from "./slices/tabRailSlice";
import type { ActivitySlice } from "./slices/activitySlice";

// Combined store type
export type ReviewStore = PreferencesSlice &
  NavigationSlice &
  GitSlice &
  ClassificationSlice &
  FilesSlice &
  ReviewSlice &
  SearchSlice &
  HistorySlice &
  SymbolsSlice &
  GroupingSlice &
  UndoSlice &
  GlobalReviewsSlice &
  ActivitySlice;

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

// Helper to get all files flattened from tree with their status
export function flattenFilesWithStatus(
  entries: FileEntry[],
): { path: string; status: FileEntry["status"] }[] {
  const result: { path: string; status: FileEntry["status"] }[] = [];
  for (const entry of entries) {
    if (entry.isDirectory && entry.children) {
      result.push(...flattenFilesWithStatus(entry.children));
    } else if (!entry.isDirectory) {
      result.push({ path: entry.path, status: entry.status });
    }
  }
  return result;
}
