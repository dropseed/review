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
export type MainViewMode = "single" | "rolling";

export interface NavigationSlice {
  // Navigation state
  selectedFile: string | null;
  focusedHunkIndex: number;

  // Main view mode (single file vs rolling)
  mainViewMode: MainViewMode;

  // Split view state
  secondaryFile: string | null;
  focusedPane: FocusedPane;
  splitOrientation: SplitOrientation;

  // Claude Code view state
  showClaudeCodeView: boolean;
  claudeCodeSelectedSessionId: string | null;

  // Actions
  setSelectedFile: (path: string | null) => void;
  nextFile: () => void;
  prevFile: () => void;
  nextHunk: () => void;
  prevHunk: () => void;

  // Main view mode actions
  setMainViewMode: (mode: MainViewMode) => void;

  // Claude Code view actions
  setShowClaudeCodeView: (show: boolean) => void;
  toggleClaudeCodeView: () => void;
  setClaudeCodeSelectedSessionId: (sessionId: string | null) => void;

  // Split view actions
  setSecondaryFile: (path: string | null) => void;
  setFocusedPane: (pane: FocusedPane) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;
  openInSplit: (path: string) => void;
  closeSplit: () => void;
  swapPanes: () => void;

  // Rolling view navigation
  scrollToFileInRolling: string | null;
  setScrollToFileInRolling: (path: string | null) => void;
}

export const createNavigationSlice: SliceCreator<NavigationSlice> = (
  set,
  get,
) => ({
  selectedFile: null,
  focusedHunkIndex: 0,

  // Main view mode
  mainViewMode: "single" as MainViewMode,

  // Split view state
  secondaryFile: null,
  focusedPane: "primary" as FocusedPane,
  splitOrientation: "horizontal" as SplitOrientation,

  // Claude Code view state
  showClaudeCodeView: false,
  claudeCodeSelectedSessionId: null,

  // Rolling view navigation
  scrollToFileInRolling: null,

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
    const { hunks, focusedHunkIndex, mainViewMode } = get();
    if (hunks.length === 0) return;
    const nextIndex = Math.min(focusedHunkIndex + 1, hunks.length - 1);
    const nextHunk = hunks[nextIndex];

    // Update selected file if the focused hunk is in a different file
    if (nextHunk) {
      if (mainViewMode === "rolling") {
        // In rolling mode, scroll to the file section
        set({
          focusedHunkIndex: nextIndex,
          scrollToFileInRolling: nextHunk.filePath,
        });
      } else {
        // In single mode, change the selected file
        set({ focusedHunkIndex: nextIndex, selectedFile: nextHunk.filePath });
      }
    } else {
      set({ focusedHunkIndex: nextIndex });
    }
  },

  prevHunk: () => {
    const { hunks, focusedHunkIndex, mainViewMode } = get();
    if (hunks.length === 0) return;
    const prevIndex = Math.max(focusedHunkIndex - 1, 0);
    const prevHunk = hunks[prevIndex];

    // Update selected file if the focused hunk is in a different file
    if (prevHunk) {
      if (mainViewMode === "rolling") {
        // In rolling mode, scroll to the file section
        set({
          focusedHunkIndex: prevIndex,
          scrollToFileInRolling: prevHunk.filePath,
        });
      } else {
        // In single mode, change the selected file
        set({ focusedHunkIndex: prevIndex, selectedFile: prevHunk.filePath });
      }
    } else {
      set({ focusedHunkIndex: prevIndex });
    }
  },

  // Main view mode actions
  setMainViewMode: (mode) => set({ mainViewMode: mode }),

  // Claude Code view actions
  setShowClaudeCodeView: (show) =>
    set({ showClaudeCodeView: show, claudeCodeSelectedSessionId: null }),

  toggleClaudeCodeView: () => {
    const { showClaudeCodeView, fetchClaudeCodeSessions } = get();
    const opening = !showClaudeCodeView;
    set({ showClaudeCodeView: opening, claudeCodeSelectedSessionId: null });
    if (opening) {
      fetchClaudeCodeSessions();
    }
  },

  setClaudeCodeSelectedSessionId: (sessionId) => {
    set({ claudeCodeSelectedSessionId: sessionId });
    if (sessionId) {
      const { fetchClaudeCodeMessages } = get();
      fetchClaudeCodeMessages(sessionId);
    }
  },

  // Rolling view navigation
  setScrollToFileInRolling: (path) => set({ scrollToFileInRolling: path }),

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
