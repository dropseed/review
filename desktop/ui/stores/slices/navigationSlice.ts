import { isHunkReviewed, isHunkTrusted } from "../../types";
import type { ReviewStore, SliceCreator } from "../types";

export type FocusedPane = "primary" | "secondary";
export type SplitOrientation = "horizontal" | "vertical";
export type GuideContentMode = "group" | null;
export type ChangesViewMode = "files" | "guide";

export interface NavigationSlice {
  // Navigation state
  selectedFile: string | null;
  focusedHunkIndex: number;
  scrollDrivenNavigation: boolean;

  // Guide content mode: what ContentArea shows when guide content is active
  guideContentMode: GuideContentMode;
  setGuideContentMode: (mode: GuideContentMode) => void;

  // Sub-mode within the Changes tab
  changesViewMode: ChangesViewMode;
  setChangesViewMode: (mode: ChangesViewMode) => void;

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

  // Navigation actions
  navigateToBrowse: (filePath?: string) => void;

  // Split view actions
  setSecondaryFile: (path: string | null) => void;
  setFocusedPane: (pane: FocusedPane) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;
  openInSplit: (path: string) => void;
  openEmptySplit: () => void;
  closeSplit: () => void;
  swapPanes: () => void;

  // Pending comment (set by reject, consumed by DiffView)
  pendingCommentHunkId: string | null;
  setPendingCommentHunkId: (hunkId: string | null) => void;

  // Advance to next hunk within the same file
  nextHunkInFile: () => void;

  // Advance to next file if current file is fully reviewed
  advanceToNextUnreviewedFile: () => void;

  // Grouping sidebar
  groupingSidebarOpen: boolean;
  setGroupingSidebarOpen: (open: boolean) => void;

  // Track the exact narrative link that was last clicked (by source offset)
  lastClickedNarrativeLinkOffset: number | null;
  setLastClickedNarrativeLinkOffset: (offset: number | null) => void;

  // Modal state
  classificationsModalOpen: boolean;
  setClassificationsModalOpen: (open: boolean) => void;

  // Comparison picker modal
  comparisonPickerOpen: boolean;
  setComparisonPickerOpen: (open: boolean) => void;
  comparisonPickerRepoPath: string | null;
  setComparisonPickerRepoPath: (path: string | null) => void;

  // Working tree diff (Git panel file selection)
  workingTreeDiffFile: string | null;
  workingTreeDiffMode: "staged" | "unstaged" | null;
  selectWorkingTreeFile: (path: string, mode?: "staged" | "unstaged") => void;

  // Active group index in focused review section
  activeGroupIndex: number;
  setActiveGroupIndex: (index: number) => void;

  // Content search modal
  contentSearchOpen: boolean;
  setContentSearchOpen: (open: boolean) => void;

  // Request a files panel tab switch from outside the panel
  requestedFilesPanelTab: string | null;
  clearRequestedFilesPanelTab: () => void;

  // Flag for symbol navigation to trigger history push instead of replace
  isProgrammaticNavigation: boolean;

  // Whether there's a pushed history entry to go back to
  canGoBack: boolean;
}

/** Check whether a hunk in the given file is unreviewed, using the current review context. */
function isFileHunkUnreviewed(
  filePath: string,
  state: ReviewStore,
): (h: { id: string; filePath: string }) => boolean {
  const { reviewState, stagedFilePaths } = state;
  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;

  return (h) => {
    if (h.filePath !== filePath) return false;
    const hunkState = reviewState?.hunks[h.id];
    return !isHunkReviewed(hunkState, trustList, {
      autoApproveStaged,
      stagedFilePaths,
      filePath: h.filePath,
    });
  };
}

/**
 * Find the index of the first unreviewed hunk for a file,
 * falling back to the first hunk in the file if all are reviewed.
 * Returns -1 if no hunks exist for the file.
 */
function findFirstUnreviewedHunkIndex(
  filePath: string,
  state: ReviewStore,
): number {
  const unreviewedIndex = state.hunks.findIndex(
    isFileHunkUnreviewed(filePath, state),
  );
  if (unreviewedIndex >= 0) return unreviewedIndex;

  // Fall back to first hunk in the file
  return state.hunks.findIndex((h) => h.filePath === filePath);
}

/** Check whether a file has any unreviewed hunks. */
function fileHasUnreviewedHunks(filePath: string, state: ReviewStore): boolean {
  return state.hunks.some(isFileHunkUnreviewed(filePath, state));
}

/** Check if a hunk is trusted and has no explicit user action (skip in navigation). */
function isHunkTrustedInState(hunkId: string, state: ReviewStore): boolean {
  const reviewState = state.reviewState;
  if (!reviewState) return false;
  const hunkState = reviewState.hunks[hunkId];
  // Only skip if trusted AND not explicitly actioned (approved/rejected/saved)
  if (hunkState?.status) return false;
  return isHunkTrusted(hunkState, reviewState.trustList);
}

export const createNavigationSlice: SliceCreator<NavigationSlice> = (
  set,
  get,
) => ({
  selectedFile: null,
  focusedHunkIndex: 0,
  scrollDrivenNavigation: false,

  // Guide content mode
  guideContentMode: null,

  // Changes view mode
  changesViewMode: "files",

  // Split view state
  secondaryFile: null,
  focusedPane: "primary",
  splitOrientation: "horizontal",

  setSelectedFile: (path) => {
    const state = get();
    const { secondaryFile, focusedPane } = state;

    const targetHunkIndex = path
      ? findFirstUnreviewedHunkIndex(path, state)
      : -1;
    const newFocusedHunkIndex = Math.max(targetHunkIndex, 0);

    const shared = {
      guideContentMode: null as GuideContentMode,
      workingTreeDiffFile: null as string | null,
      workingTreeDiffMode: null as "staged" | "unstaged" | null,
    };

    const isSplitActive = secondaryFile !== null;

    // Split active with secondary pane focused: update secondary pane
    if (isSplitActive && focusedPane === "secondary") {
      if (path === null) {
        // Closing the secondary file closes the split
        set({ ...shared, secondaryFile: null, focusedPane: "primary" });
      } else {
        set({
          ...shared,
          secondaryFile: path,
          focusedHunkIndex: newFocusedHunkIndex,
        });
      }
      return;
    }

    // Split active with primary pane focused: closing primary promotes secondary
    if (isSplitActive && path === null) {
      set({
        ...shared,
        selectedFile: secondaryFile,
        secondaryFile: null,
        focusedPane: "primary",
        focusedHunkIndex: newFocusedHunkIndex,
      });
      return;
    }

    // Default: update primary pane
    set({
      ...shared,
      selectedFile: path,
      focusedHunkIndex: newFocusedHunkIndex,
    });
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
    const state = get();
    const { hunks, focusedHunkIndex } = state;
    if (hunks.length === 0) return;
    // Scan forward to find the next non-trusted hunk
    for (let i = focusedHunkIndex + 1; i < hunks.length; i++) {
      if (!isHunkTrustedInState(hunks[i].id, state)) {
        set({ focusedHunkIndex: i, selectedFile: hunks[i].filePath });
        return;
      }
    }
    // All remaining hunks are trusted — stay at current position
  },

  prevHunk: () => {
    const state = get();
    const { hunks, focusedHunkIndex } = state;
    if (hunks.length === 0) return;
    // Scan backward to find the previous non-trusted hunk
    for (let i = focusedHunkIndex - 1; i >= 0; i--) {
      if (!isHunkTrustedInState(hunks[i].id, state)) {
        set({ focusedHunkIndex: i, selectedFile: hunks[i].filePath });
        return;
      }
    }
    // All preceding hunks are trusted — stay at current position
  },

  // Guide content mode
  setGuideContentMode: (mode) => set({ guideContentMode: mode }),

  // Changes view mode
  setChangesViewMode: (mode) => set({ changesViewMode: mode }),

  navigateToBrowse: (filePath?) => {
    if (filePath === undefined) {
      set({ guideContentMode: null });
      return;
    }

    const state = get();
    const targetHunkIndex = findFirstUnreviewedHunkIndex(filePath, state);

    set({
      guideContentMode: null,
      selectedFile: filePath,
      filesPanelCollapsed: false,
      ...(targetHunkIndex >= 0 && { focusedHunkIndex: targetHunkIndex }),
    });
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
        diffViewMode: "unified",
      });
    }
  },

  openEmptySplit: () => {
    const { secondaryFile } = get();
    // Already in split mode — don't reset
    if (secondaryFile !== null) return;
    set({
      secondaryFile: "",
      focusedPane: "secondary",
      diffViewMode: "unified",
    });
  },

  closeSplit: () => set({ secondaryFile: null, focusedPane: "primary" }),

  // Pending comment
  pendingCommentHunkId: null,
  setPendingCommentHunkId: (hunkId) => set({ pendingCommentHunkId: hunkId }),

  // Advance to next hunk within the same file, skipping trusted hunks
  nextHunkInFile: () => {
    const state = get();
    const { hunks, focusedHunkIndex } = state;
    if (hunks.length === 0) return;
    const currentHunk = hunks[focusedHunkIndex];
    if (!currentHunk) return;
    // Scan forward within the same file, skipping trusted hunks
    for (let i = focusedHunkIndex + 1; i < hunks.length; i++) {
      if (hunks[i].filePath !== currentHunk.filePath) break;
      if (!isHunkTrustedInState(hunks[i].id, state)) {
        set({ focusedHunkIndex: i });
        return;
      }
    }
  },

  // Advance to next file if current file is fully reviewed
  advanceToNextUnreviewedFile: () => {
    const state = get();
    const { selectedFile, flatFileList, setSelectedFile } = state;
    if (!selectedFile || flatFileList.length === 0) return;

    // If current file still has unreviewed hunks, don't advance
    if (fileHasUnreviewedHunks(selectedFile, state)) return;

    // Find the next file with unreviewed hunks
    const currentIndex = flatFileList.indexOf(selectedFile);
    for (let i = 1; i < flatFileList.length; i++) {
      const nextIndex = (currentIndex + i) % flatFileList.length;
      const nextFile = flatFileList[nextIndex];

      if (fileHasUnreviewedHunks(nextFile, state)) {
        setSelectedFile(nextFile);
        return;
      }
    }
    // All files are fully reviewed - stay on current file
  },

  // Grouping sidebar
  groupingSidebarOpen: false,
  setGroupingSidebarOpen: (open) => set({ groupingSidebarOpen: open }),

  lastClickedNarrativeLinkOffset: null,
  setLastClickedNarrativeLinkOffset: (offset) =>
    set({ lastClickedNarrativeLinkOffset: offset }),

  // Modal state
  classificationsModalOpen: false,
  setClassificationsModalOpen: (open) =>
    set({ classificationsModalOpen: open }),

  // Comparison picker modal
  comparisonPickerOpen: false,
  setComparisonPickerOpen: (open) => set({ comparisonPickerOpen: open }),
  comparisonPickerRepoPath: null,
  setComparisonPickerRepoPath: (path) =>
    set({ comparisonPickerRepoPath: path }),

  // Working tree diff (Git panel file selection)
  workingTreeDiffFile: null,
  workingTreeDiffMode: null,
  selectWorkingTreeFile: (path, mode) => {
    const targetHunkIndex = findFirstUnreviewedHunkIndex(path, get());
    set({
      selectedFile: path,
      workingTreeDiffFile: path,
      workingTreeDiffMode: mode ?? "unstaged",
      focusedHunkIndex: Math.max(targetHunkIndex, 0),
      guideContentMode: null,
    });
  },

  swapPanes: () => {
    const { selectedFile, secondaryFile } = get();
    set({
      selectedFile: secondaryFile,
      secondaryFile: selectedFile,
      focusedHunkIndex: 0,
    });
  },

  // Active group index
  activeGroupIndex: 0,
  setActiveGroupIndex: (index) => set({ activeGroupIndex: index }),

  // Content search modal
  contentSearchOpen: false,
  setContentSearchOpen: (open) => set({ contentSearchOpen: open }),

  // Requested files panel tab
  requestedFilesPanelTab: null,
  clearRequestedFilesPanelTab: () => set({ requestedFilesPanelTab: null }),

  // Programmatic navigation flag
  isProgrammaticNavigation: false,

  // Back navigation
  canGoBack: false,
});
