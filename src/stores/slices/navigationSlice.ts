import type { SliceCreator } from "../types";
import { flattenFiles } from "../types";

export interface NavigationSlice {
  // Navigation state
  selectedFile: string | null;
  focusedHunkIndex: number;

  // Actions
  setSelectedFile: (path: string | null) => void;
  nextFile: () => void;
  prevFile: () => void;
  nextHunk: () => void;
  prevHunk: () => void;
}

export const createNavigationSlice: SliceCreator<NavigationSlice> = (
  set,
  get,
) => ({
  selectedFile: null,
  focusedHunkIndex: 0,

  setSelectedFile: (path) => set({ selectedFile: path, focusedHunkIndex: 0 }),

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
});
