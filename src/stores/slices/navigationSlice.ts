import type { SliceCreator } from "../types";

// ========================================================================
// Navigation Slice
// ========================================================================
//
// This slice manages navigation state (selected file, focused hunk, etc.)
// and intentionally accesses data from other slices via get():
//
// - `hunks` from FilesSlice: to find hunk indices when navigating
// - `flatFileList` from FilesSlice: to navigate between files
//
// This cross-slice access is the standard Zustand pattern for combined
// stores. All slices are merged into a single store, so get() returns
// the complete state including all slices.
//
// ========================================================================

export type FocusedPane = "primary" | "secondary";
export type SplitOrientation = "horizontal" | "vertical";
export type TopLevelView = "overview" | "browse";

export interface NavigationSlice {
  // Navigation state
  selectedFile: string | null;
  focusedHunkIndex: number;
  scrollDrivenNavigation: boolean;

  // View hierarchy: overview (home) vs browse
  topLevelView: TopLevelView;

  // Split view state
  secondaryFile: string | null;
  focusedPane: FocusedPane;
  splitOrientation: SplitOrientation;

  // Actions
  setSelectedFile: (path: string | null) => void;
  nextFile: () => void;
  prevFile: () => void;
  nextHunk: () => void;
  prevHunk: () => void;

  // View hierarchy actions
  setTopLevelView: (view: TopLevelView) => void;
  navigateToBrowse: (filePath?: string) => void;
  navigateToOverview: () => void;

  // Split view actions
  setSecondaryFile: (path: string | null) => void;
  setFocusedPane: (pane: FocusedPane) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;
  openInSplit: (path: string) => void;
  closeSplit: () => void;
  swapPanes: () => void;

  // Pending comment (set by reject, consumed by DiffView)
  pendingCommentHunkId: string | null;
  setPendingCommentHunkId: (hunkId: string | null) => void;

  // Advance to next hunk within the same file
  nextHunkInFile: () => void;

  // Modal state
  classificationsModalOpen: boolean;
  setClassificationsModalOpen: (open: boolean) => void;
}

export const createNavigationSlice: SliceCreator<NavigationSlice> = (
  set,
  get,
) => ({
  selectedFile: null,
  focusedHunkIndex: 0,
  scrollDrivenNavigation: false,

  // View hierarchy
  topLevelView: "overview" as TopLevelView,

  // Split view state
  secondaryFile: null,
  focusedPane: "primary" as FocusedPane,
  splitOrientation: "horizontal" as SplitOrientation,

  setSelectedFile: (path) => {
    const { secondaryFile, focusedPane, hunks } = get();
    // Find the index of the first hunk in the selected file
    const firstHunkIndex = path
      ? hunks.findIndex((h) => h.filePath === path)
      : -1;
    const newFocusedHunkIndex = firstHunkIndex >= 0 ? firstHunkIndex : 0;

    // If split is active and secondary pane is focused, update secondary instead
    if (secondaryFile !== null && focusedPane === "secondary") {
      set({ secondaryFile: path, focusedHunkIndex: newFocusedHunkIndex });
    } else {
      set({ selectedFile: path, focusedHunkIndex: newFocusedHunkIndex });
    }
  },

  nextFile: () => {
    const { flatFileList, selectedFile } = get();
    if (flatFileList.length === 0) return;

    if (!selectedFile) {
      set({ selectedFile: flatFileList[0], focusedHunkIndex: 0 });
      return;
    }

    const currentIndex = flatFileList.indexOf(selectedFile);
    const nextIndex = (currentIndex + 1) % flatFileList.length;
    set({ selectedFile: flatFileList[nextIndex], focusedHunkIndex: 0 });
  },

  prevFile: () => {
    const { flatFileList, selectedFile } = get();
    if (flatFileList.length === 0) return;

    if (!selectedFile) {
      set({
        selectedFile: flatFileList[flatFileList.length - 1],
        focusedHunkIndex: 0,
      });
      return;
    }

    const currentIndex = flatFileList.indexOf(selectedFile);
    const prevIndex =
      currentIndex <= 0 ? flatFileList.length - 1 : currentIndex - 1;
    set({ selectedFile: flatFileList[prevIndex], focusedHunkIndex: 0 });
  },

  nextHunk: () => {
    const { hunks, focusedHunkIndex } = get();
    if (hunks.length === 0) return;
    const nextIndex = Math.min(focusedHunkIndex + 1, hunks.length - 1);
    const nextHunk = hunks[nextIndex];

    if (nextHunk) {
      set({ focusedHunkIndex: nextIndex, selectedFile: nextHunk.filePath });
    } else {
      set({ focusedHunkIndex: nextIndex });
    }
  },

  prevHunk: () => {
    const { hunks, focusedHunkIndex } = get();
    if (hunks.length === 0) return;
    const prevIndex = Math.max(focusedHunkIndex - 1, 0);
    const prevHunk = hunks[prevIndex];

    if (prevHunk) {
      set({ focusedHunkIndex: prevIndex, selectedFile: prevHunk.filePath });
    } else {
      set({ focusedHunkIndex: prevIndex });
    }
  },

  // View hierarchy actions
  setTopLevelView: (view) => set({ topLevelView: view }),
  navigateToBrowse: (filePath?) => {
    const updates: Partial<NavigationSlice> = { topLevelView: "browse" };
    if (filePath !== undefined) {
      updates.selectedFile = filePath;
      // Find the index of the first hunk in the selected file
      const { hunks } = get();
      const firstHunkIndex = hunks.findIndex((h) => h.filePath === filePath);
      if (firstHunkIndex >= 0) {
        updates.focusedHunkIndex = firstHunkIndex;
      }
    }
    set(updates);
  },
  navigateToOverview: () => set({ topLevelView: "overview" }),

  // Split view actions
  setSecondaryFile: (path) => set({ secondaryFile: path }),

  setFocusedPane: (pane) => set({ focusedPane: pane, focusedHunkIndex: 0 }),

  setSplitOrientation: (orientation) => set({ splitOrientation: orientation }),

  openInSplit: (path) => {
    const { selectedFile } = get();
    // If no file is selected, open the file in primary pane instead
    if (selectedFile === null) {
      set({ selectedFile: path, focusedHunkIndex: 0 });
    } else {
      // Open in secondary pane and focus it
      set({
        secondaryFile: path,
        focusedPane: "secondary",
        focusedHunkIndex: 0,
      });
    }
  },

  closeSplit: () => set({ secondaryFile: null, focusedPane: "primary" }),

  // Pending comment
  pendingCommentHunkId: null,
  setPendingCommentHunkId: (hunkId) => set({ pendingCommentHunkId: hunkId }),

  // Advance to next hunk within the same file
  nextHunkInFile: () => {
    const { hunks, focusedHunkIndex } = get();
    if (hunks.length === 0) return;
    const currentHunk = hunks[focusedHunkIndex];
    if (!currentHunk) return;
    const nextIndex = focusedHunkIndex + 1;
    const nextHunk = hunks[nextIndex];
    if (nextHunk && nextHunk.filePath === currentHunk.filePath) {
      set({ focusedHunkIndex: nextIndex });
    }
  },

  // Modal state
  classificationsModalOpen: false,
  setClassificationsModalOpen: (open) =>
    set({ classificationsModalOpen: open }),

  swapPanes: () => {
    const { selectedFile, secondaryFile } = get();
    set({
      selectedFile: secondaryFile,
      secondaryFile: selectedFile,
      focusedHunkIndex: 0,
    });
  },
});
