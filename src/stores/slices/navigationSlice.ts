import type { SliceCreator } from "../types";
import { flattenFiles } from "../types";

export type FocusedPane = "primary" | "secondary";
export type SplitOrientation = "horizontal" | "vertical";

export interface NavigationSlice {
  // Navigation state
  selectedFile: string | null;
  focusedHunkIndex: number;

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

  // Split view actions
  setSecondaryFile: (path: string | null) => void;
  setFocusedPane: (pane: FocusedPane) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;
  openInSplit: (path: string) => void;
  closeSplit: () => void;
  swapPanes: () => void;
}

export const createNavigationSlice: SliceCreator<NavigationSlice> = (
  set,
  get,
) => ({
  selectedFile: null,
  focusedHunkIndex: 0,

  // Split view state
  secondaryFile: null,
  focusedPane: "primary" as FocusedPane,
  splitOrientation: "horizontal" as SplitOrientation,

  setSelectedFile: (path) => {
    const { secondaryFile, focusedPane } = get();
    // If split is active and secondary pane is focused, update secondary instead
    if (secondaryFile !== null && focusedPane === "secondary") {
      set({ secondaryFile: path, focusedHunkIndex: 0 });
    } else {
      set({ selectedFile: path, focusedHunkIndex: 0 });
    }
  },

  nextFile: () => {
    const { files, selectedFile } = get();
    const flatFiles = flattenFiles(files);
    if (flatFiles.length === 0) return;

    if (!selectedFile) {
      set({ selectedFile: flatFiles[0], focusedHunkIndex: 0 });
      return;
    }

    const currentIndex = flatFiles.indexOf(selectedFile);
    const nextIndex = (currentIndex + 1) % flatFiles.length;
    set({ selectedFile: flatFiles[nextIndex], focusedHunkIndex: 0 });
  },

  prevFile: () => {
    const { files, selectedFile } = get();
    const flatFiles = flattenFiles(files);
    if (flatFiles.length === 0) return;

    if (!selectedFile) {
      set({
        selectedFile: flatFiles[flatFiles.length - 1],
        focusedHunkIndex: 0,
      });
      return;
    }

    const currentIndex = flatFiles.indexOf(selectedFile);
    const prevIndex =
      currentIndex <= 0 ? flatFiles.length - 1 : currentIndex - 1;
    set({ selectedFile: flatFiles[prevIndex], focusedHunkIndex: 0 });
  },

  nextHunk: () => {
    const { hunks, focusedHunkIndex } = get();
    if (hunks.length === 0) return;
    const nextIndex = Math.min(focusedHunkIndex + 1, hunks.length - 1);
    set({ focusedHunkIndex: nextIndex });
  },

  prevHunk: () => {
    const { focusedHunkIndex } = get();
    const prevIndex = Math.max(focusedHunkIndex - 1, 0);
    set({ focusedHunkIndex: prevIndex });
  },

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

  swapPanes: () => {
    const { selectedFile, secondaryFile } = get();
    set({
      selectedFile: secondaryFile,
      secondaryFile: selectedFile,
      focusedHunkIndex: 0,
    });
  },
});
