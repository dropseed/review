import { create } from "zustand";
import type { ReviewStore } from "./types";

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

// Re-export types
export type { ReviewStore };
export type {
  PreferencesSlice,
  NavigationSlice,
  GitSlice,
  ClassificationSlice,
  FilesSlice,
  ReviewSlice,
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

// Combined store
export const useReviewStore = create<ReviewStore>()((...args) => ({
  ...createPreferencesSlice(...args),
  ...createNavigationSlice(...args),
  ...createGitSlice(...args),
  ...createClassificationSlice(...args),
  ...createFilesSlice(...args),
  ...createReviewSlice(...args),
}));
