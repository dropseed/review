/**
 * Sync Slice
 *
 * Manages review state synchronization for the iOS companion app.
 * Handles fetching and updating review state from the desktop server.
 */

import type { StateCreator } from "zustand";
import type { ReviewState, FileEntry, FileContent, DiffHunk } from "@/types";
import type { ComparisonInfo, SyncClient } from "@/api/sync-client";
import { SyncConflictError } from "@/api/sync-client";

export type MobileLayoutMode = "cards" | "list";

export interface SyncSlice {
  // Remote data
  comparisons: ComparisonInfo[];
  currentComparisonKey: string | null;
  remoteState: ReviewState | null;
  remoteFiles: FileEntry[];
  fileContents: Map<string, FileContent>;

  // UI state
  layoutMode: MobileLayoutMode;
  selectedFile: string | null;
  currentHunkIndex: number;

  // Actions
  fetchComparisons: (syncClient: SyncClient, repoId: string) => Promise<void>;
  selectComparison: (
    syncClient: SyncClient,
    repoId: string,
    comparisonKey: string,
  ) => Promise<void>;
  refreshState: (syncClient: SyncClient, repoId: string) => Promise<void>;

  // Hunk operations
  approveHunk: (
    syncClient: SyncClient,
    repoId: string,
    hunkId: string,
  ) => Promise<void>;
  rejectHunk: (
    syncClient: SyncClient,
    repoId: string,
    hunkId: string,
  ) => Promise<void>;
  resetHunk: (
    syncClient: SyncClient,
    repoId: string,
    hunkId: string,
  ) => Promise<void>;
  addTrustPattern: (
    syncClient: SyncClient,
    repoId: string,
    pattern: string,
  ) => Promise<void>;

  // UI actions
  setLayoutMode: (mode: MobileLayoutMode) => void;
  setSelectedFile: (filePath: string | null) => void;
  setCurrentHunkIndex: (index: number) => void;
  nextHunk: () => void;
  previousHunk: () => void;

  // Computed helpers
  getAllHunks: () => DiffHunk[];
  getFilteredHunks: () => DiffHunk[];
  getCurrentHunk: () => DiffHunk | null;

  // Reset
  resetSyncState: () => void;
}

const initialSyncState = {
  comparisons: [],
  currentComparisonKey: null,
  remoteState: null,
  remoteFiles: [],
  fileContents: new Map<string, FileContent>(),
  layoutMode: "cards" as MobileLayoutMode,
  selectedFile: null,
  currentHunkIndex: 0,
};

export const createSyncSlice: StateCreator<SyncSlice> = (set, get) => ({
  ...initialSyncState,

  fetchComparisons: async (syncClient, repoId) => {
    try {
      const comparisons = await syncClient.listComparisons(repoId);
      set({ comparisons });
    } catch (error) {
      console.error("[Sync] Failed to fetch comparisons:", error);
    }
  },

  selectComparison: async (syncClient, repoId, comparisonKey) => {
    set({
      currentComparisonKey: comparisonKey,
      fileContents: new Map(),
      currentHunkIndex: 0,
      selectedFile: null,
    });

    try {
      const [state, files] = await Promise.all([
        syncClient.getState(repoId, comparisonKey),
        syncClient.getFiles(repoId, comparisonKey),
      ]);

      set({ remoteState: state, remoteFiles: files });

      // Get unique file paths from the file tree (look for files with hunks)
      const filePaths = new Set<string>();
      const collectFilePaths = (entries: FileEntry[]) => {
        for (const entry of entries) {
          if (!entry.isDirectory && entry.status) {
            filePaths.add(entry.path);
          }
          if (entry.children) {
            collectFilePaths(entry.children);
          }
        }
      };
      collectFilePaths(files);

      // Fetch content for each file (in parallel, limit concurrency)
      const filePathArray = Array.from(filePaths);
      const fileContents = new Map<string, FileContent>();

      // Fetch in batches of 5
      const batchSize = 5;
      for (let i = 0; i < filePathArray.length; i += batchSize) {
        const batch = filePathArray.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (filePath) => {
            try {
              const content = await syncClient.getFileContent(
                repoId,
                comparisonKey,
                filePath,
              );
              return { filePath, content };
            } catch (error) {
              console.error(
                `[Sync] Failed to fetch content for ${filePath}:`,
                error,
              );
              return null;
            }
          }),
        );

        results.forEach((result) => {
          if (result) {
            fileContents.set(result.filePath, result.content);
          }
        });
      }

      set({ fileContents });
    } catch (error) {
      console.error("[Sync] Failed to fetch state:", error);
    }
  },

  refreshState: async (syncClient, repoId) => {
    const { currentComparisonKey } = get();
    if (!currentComparisonKey) return;

    try {
      const state = await syncClient.getState(repoId, currentComparisonKey);
      set({ remoteState: state });
    } catch (error) {
      console.error("[Sync] Failed to refresh state:", error);
    }
  },

  approveHunk: async (syncClient, repoId, hunkId) => {
    const { remoteState, currentComparisonKey } = get();
    if (!remoteState || !currentComparisonKey) return;

    const updatedState: ReviewState = {
      ...remoteState,
      hunks: {
        ...remoteState.hunks,
        [hunkId]: {
          ...remoteState.hunks[hunkId],
          label: remoteState.hunks[hunkId]?.label || [],
          status: "approved",
        },
      },
    };

    // Optimistic update
    set({ remoteState: updatedState });

    try {
      const updated = await syncClient.updateState(
        repoId,
        currentComparisonKey,
        updatedState,
        remoteState.version,
      );
      set({ remoteState: updated });
    } catch (error) {
      if (error instanceof SyncConflictError) {
        console.warn("[Sync] Conflict detected, refreshing state");
        await get().refreshState(syncClient, repoId);
      } else {
        // Revert on error
        set({ remoteState });
        throw error;
      }
    }
  },

  rejectHunk: async (syncClient, repoId, hunkId) => {
    const { remoteState, currentComparisonKey } = get();
    if (!remoteState || !currentComparisonKey) return;

    const updatedState: ReviewState = {
      ...remoteState,
      hunks: {
        ...remoteState.hunks,
        [hunkId]: {
          ...remoteState.hunks[hunkId],
          label: remoteState.hunks[hunkId]?.label || [],
          status: "rejected",
        },
      },
    };

    // Optimistic update
    set({ remoteState: updatedState });

    try {
      const updated = await syncClient.updateState(
        repoId,
        currentComparisonKey,
        updatedState,
        remoteState.version,
      );
      set({ remoteState: updated });
    } catch (error) {
      if (error instanceof SyncConflictError) {
        console.warn("[Sync] Conflict detected, refreshing state");
        await get().refreshState(syncClient, repoId);
      } else {
        set({ remoteState });
        throw error;
      }
    }
  },

  resetHunk: async (syncClient, repoId, hunkId) => {
    const { remoteState, currentComparisonKey } = get();
    if (!remoteState || !currentComparisonKey) return;

    const currentHunk = remoteState.hunks[hunkId];
    if (!currentHunk) return;

    const updatedState: ReviewState = {
      ...remoteState,
      hunks: {
        ...remoteState.hunks,
        [hunkId]: {
          ...currentHunk,
          status: undefined,
        },
      },
    };

    // Optimistic update
    set({ remoteState: updatedState });

    try {
      const updated = await syncClient.updateState(
        repoId,
        currentComparisonKey,
        updatedState,
        remoteState.version,
      );
      set({ remoteState: updated });
    } catch (error) {
      if (error instanceof SyncConflictError) {
        console.warn("[Sync] Conflict detected, refreshing state");
        await get().refreshState(syncClient, repoId);
      } else {
        set({ remoteState });
        throw error;
      }
    }
  },

  addTrustPattern: async (syncClient, repoId, pattern) => {
    const { remoteState, currentComparisonKey } = get();
    if (!remoteState || !currentComparisonKey) return;

    if (remoteState.trustList.includes(pattern)) return;

    const updatedState: ReviewState = {
      ...remoteState,
      trustList: [...remoteState.trustList, pattern],
    };

    // Optimistic update
    set({ remoteState: updatedState });

    try {
      const updated = await syncClient.updateState(
        repoId,
        currentComparisonKey,
        updatedState,
        remoteState.version,
      );
      set({ remoteState: updated });
    } catch (error) {
      if (error instanceof SyncConflictError) {
        console.warn("[Sync] Conflict detected, refreshing state");
        await get().refreshState(syncClient, repoId);
      } else {
        set({ remoteState });
        throw error;
      }
    }
  },

  setLayoutMode: (mode) => {
    set({ layoutMode: mode });
  },

  setSelectedFile: (filePath) => {
    set({ selectedFile: filePath, currentHunkIndex: 0 });
  },

  setCurrentHunkIndex: (index) => {
    const hunks = get().getFilteredHunks();
    if (index >= 0 && index < hunks.length) {
      set({ currentHunkIndex: index });
    }
  },

  nextHunk: () => {
    const { currentHunkIndex } = get();
    const hunks = get().getFilteredHunks();
    if (currentHunkIndex < hunks.length - 1) {
      set({ currentHunkIndex: currentHunkIndex + 1 });
    }
  },

  previousHunk: () => {
    const { currentHunkIndex } = get();
    if (currentHunkIndex > 0) {
      set({ currentHunkIndex: currentHunkIndex - 1 });
    }
  },

  getAllHunks: () => {
    const { fileContents } = get();
    const allHunks: DiffHunk[] = [];

    fileContents.forEach((content) => {
      allHunks.push(...content.hunks);
    });

    // Sort by file path then by start line
    return allHunks.sort((a, b) => {
      if (a.filePath !== b.filePath) {
        return a.filePath.localeCompare(b.filePath);
      }
      return a.newStart - b.newStart;
    });
  },

  getFilteredHunks: () => {
    const { selectedFile } = get();
    const allHunks = get().getAllHunks();

    if (!selectedFile) {
      return allHunks;
    }

    return allHunks.filter((hunk) => hunk.filePath === selectedFile);
  },

  getCurrentHunk: () => {
    const { currentHunkIndex } = get();
    const hunks = get().getFilteredHunks();
    return hunks[currentHunkIndex] || null;
  },

  resetSyncState: () => {
    set(initialSyncState);
  },
});
