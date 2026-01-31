import { create } from "zustand";
import type { ReviewStore } from "./types";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";

import { createPreferencesSlice } from "./slices/preferencesSlice";
import { createNavigationSlice } from "./slices/navigationSlice";
import { createGitSlice } from "./slices/gitSlice";
import { createClassificationSlice } from "./slices/classificationSlice";
import { createFilesSlice } from "./slices/filesSlice";
import { createReviewSlice } from "./slices/reviewSlice";
import { createSearchSlice } from "./slices/searchSlice";
import { createHistorySlice } from "./slices/historySlice";
import { createSymbolsSlice } from "./slices/symbolsSlice";
import { createNarrativeSlice } from "./slices/narrativeSlice";

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
  ...createHistorySlice(apiClient)(...args),
  ...createSymbolsSlice(apiClient)(...args),
  ...createNarrativeSlice(apiClient)(...args),
}));
