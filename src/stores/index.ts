import { create } from "zustand";
import type { ReviewStore } from "./types";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";

import {
  createPreferencesSlice,
  type PreferencesSlice,
} from "./slices/preferencesSlice";
import {
  createNavigationSlice,
  type NavigationSlice,
} from "./slices/navigationSlice";
import { createGitSlice, type GitSlice } from "./slices/gitSlice";
import {
  createClassificationSlice,
  type ClassificationSlice,
} from "./slices/classificationSlice";
import { createFilesSlice, type FilesSlice } from "./slices/filesSlice";
import { createReviewSlice, type ReviewSlice } from "./slices/reviewSlice";
import { createSearchSlice, type SearchSlice } from "./slices/searchSlice";
import { createSyncSlice, type SyncSlice } from "./slices/syncSlice";

// Re-export types
export type { ReviewStore };
export type {
  PreferencesSlice,
  NavigationSlice,
  GitSlice,
  ClassificationSlice,
  FilesSlice,
  ReviewSlice,
  SearchSlice,
  SyncSlice,
};

// Re-export types from main types file
export type {
  Comparison,
  FileEntry,
  DiffHunk,
  ReviewState,
  ReviewSummary,
  MovePair,
  RejectionFeedback,
  LineAnnotation,
  GitStatusSummary,
} from "./types";

// Get dependencies
const apiClient = getApiClient();
const platform = getPlatformServices();

// Combined store with injected dependencies
export const useReviewStore = create<ReviewStore>()((...args) => ({
  ...createPreferencesSlice(platform.storage)(...args),
  ...createNavigationSlice(...args),
  ...createGitSlice(apiClient)(...args),
  ...createClassificationSlice(apiClient)(...args),
  ...createFilesSlice(apiClient)(...args),
  ...createReviewSlice(apiClient)(...args),
  ...createSearchSlice(apiClient)(...args),
  ...createSyncSlice(platform.storage)(...args),
}));
