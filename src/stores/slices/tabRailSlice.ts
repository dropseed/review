import type { Comparison } from "../../types";
import type { StorageService } from "../../platform";
import type { SliceCreatorWithStorage } from "../types";

export interface OpenReview {
  repoPath: string;
  repoName: string; // display name (remote name or dirname)
  comparison: Comparison;
  routePrefix: string; // e.g. "dropseed/review" for URL construction
}

export interface TabRailSlice {
  openReviews: OpenReview[];
  activeTabIndex: number | null;

  loadOpenReviews: () => Promise<void>;
  addOpenReview: (review: OpenReview) => void;
  removeOpenReview: (index: number) => void;
  setActiveTab: (index: number) => void;
  updateTabComparison: (index: number, comparison: Comparison) => void;
}

const STORAGE_KEY = "openReviews";

export const createTabRailSlice: SliceCreatorWithStorage<TabRailSlice> =
  (storage: StorageService) => (set, get) => ({
    openReviews: [],
    activeTabIndex: null,

    loadOpenReviews: async () => {
      const stored = (await storage.get<OpenReview[]>(STORAGE_KEY)) ?? [];
      set({ openReviews: stored });
    },

    addOpenReview: (review) => {
      const { openReviews } = get();

      // Check if this repo+comparison already has a tab
      const existingIndex = openReviews.findIndex(
        (r) =>
          r.repoPath === review.repoPath &&
          r.comparison.key === review.comparison.key,
      );

      if (existingIndex >= 0) {
        // Tab already exists — just activate it
        set({ activeTabIndex: existingIndex });
        return;
      }

      // Check if this repo already has a tab (same repo, different comparison)
      const sameRepoIndex = openReviews.findIndex(
        (r) => r.repoPath === review.repoPath,
      );

      if (sameRepoIndex >= 0) {
        // Update existing tab's comparison instead of adding a new one
        const updated = [...openReviews];
        updated[sameRepoIndex] = { ...updated[sameRepoIndex], ...review };
        set({ openReviews: updated, activeTabIndex: sameRepoIndex });
        storage.set(STORAGE_KEY, updated);
        return;
      }

      const updated = [...openReviews, review];
      set({ openReviews: updated, activeTabIndex: updated.length - 1 });
      storage.set(STORAGE_KEY, updated);
    },

    removeOpenReview: (index) => {
      const { openReviews, activeTabIndex } = get();
      if (index < 0 || index >= openReviews.length) return;

      const updated = openReviews.filter((_, i) => i !== index);

      // Adjust active tab
      let newActiveIndex: number | null = activeTabIndex;
      if (updated.length === 0) {
        newActiveIndex = null;
      } else if (activeTabIndex !== null) {
        if (index === activeTabIndex) {
          // Removed the active tab — activate the nearest one
          newActiveIndex = Math.min(index, updated.length - 1);
        } else if (index < activeTabIndex) {
          // Removed a tab before the active one — shift index down
          newActiveIndex = activeTabIndex - 1;
        }
      }

      set({ openReviews: updated, activeTabIndex: newActiveIndex });
      storage.set(STORAGE_KEY, updated);
    },

    setActiveTab: (index) => {
      const { openReviews } = get();
      if (index >= 0 && index < openReviews.length) {
        set({ activeTabIndex: index });
      }
    },

    updateTabComparison: (index, comparison) => {
      const { openReviews } = get();
      if (index < 0 || index >= openReviews.length) return;

      const updated = [...openReviews];
      updated[index] = { ...updated[index], comparison };

      set({ openReviews: updated });
      storage.set(STORAGE_KEY, updated);
    },
  });
