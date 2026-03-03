import { isHunkReviewed, isHunkTrusted } from "../../types";
import type { HunkGroup } from "../../types";
import type { ReviewStore, SliceCreator } from "../types";

export type FocusedPane = "primary" | "secondary";
export type SplitOrientation = "horizontal" | "vertical";
export type GuideContentMode = "group" | "adhoc-group" | null;
export type ChangesViewMode = "files" | "guide";

export type ScrollTarget =
  | { type: "hunk"; hunkId: string }
  | { type: "line"; filePath: string; lineNumber: number };

export interface NavigationSlice {
  // Navigation state
  selectedFile: string | null;
  focusedHunkId: string | null;
  scrollTarget: ScrollTarget | null;
  clearScrollTarget: () => void;

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
  revealInBrowse: (filePath: string) => void;

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

  // Working tree diff (Git panel file selection)
  workingTreeDiffFile: string | null;
  workingTreeDiffMode: "staged" | "unstaged" | null;
  selectWorkingTreeFile: (path: string, mode?: "staged" | "unstaged") => void;

  // Active group index in focused review section
  activeGroupIndex: number;
  setActiveGroupIndex: (index: number) => void;

  // Ad-hoc hunk group (used with guideContentMode "adhoc-group")
  adhocGroup: HunkGroup | null;

  // Viewing a commit diff inline
  viewingCommitHash: string | null;
  setViewingCommitHash: (hash: string | null) => void;

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
 * Find the ID of the first unreviewed hunk for a file,
 * falling back to the first hunk in the file if all are reviewed.
 * Returns null if no hunks exist for the file.
 */
export function findFirstUnreviewedHunkId(
  filePath: string,
  state: ReviewStore,
): string | null {
  const unreviewed = state.hunks.find(isFileHunkUnreviewed(filePath, state));
  if (unreviewed) return unreviewed.id;
  return state.hunks.find((h) => h.filePath === filePath)?.id ?? null;
}

/** Find the current index of the focused hunk by ID. Returns -1 if not found. */
function focusedHunkPosition(state: ReviewStore): number {
  if (!state.focusedHunkId) return -1;
  return state.hunks.findIndex((h) => h.id === state.focusedHunkId);
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
  focusedHunkId: null,
  scrollTarget: null,
  clearScrollTarget: () => set({ scrollTarget: null }),

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

    const targetHunkId = path ? findFirstUnreviewedHunkId(path, state) : null;

    const shared = {
      guideContentMode: null as GuideContentMode,
      workingTreeDiffFile: null as string | null,
      workingTreeDiffMode: null as "staged" | "unstaged" | null,
      viewingCommitHash: null as string | null,
    };

    const hunkNav = targetHunkId
      ? {
          focusedHunkId: targetHunkId,
          scrollTarget: { type: "hunk" as const, hunkId: targetHunkId },
        }
      : {
          focusedHunkId: null as string | null,
          scrollTarget: null as ScrollTarget | null,
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
          ...hunkNav,
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
        ...hunkNav,
      });
      return;
    }

    // Default: update primary pane
    set({
      ...shared,
      selectedFile: path,
      ...hunkNav,
    });
  },

  nextFile: () => {
    const state = get();
    const { flatFileList, selectedFile } = state;
    if (flatFileList.length === 0) return;

    const nextFilePath = !selectedFile
      ? flatFileList[0]
      : flatFileList[
          (flatFileList.indexOf(selectedFile) + 1) % flatFileList.length
        ];

    const hunkId = findFirstUnreviewedHunkId(nextFilePath, state);
    set({
      selectedFile: nextFilePath,
      focusedHunkId: hunkId,
      scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
    });
  },

  prevFile: () => {
    const state = get();
    const { flatFileList, selectedFile } = state;
    if (flatFileList.length === 0) return;

    const prevFilePath = !selectedFile
      ? flatFileList[flatFileList.length - 1]
      : flatFileList[
          flatFileList.indexOf(selectedFile) <= 0
            ? flatFileList.length - 1
            : flatFileList.indexOf(selectedFile) - 1
        ];

    const hunkId = findFirstUnreviewedHunkId(prevFilePath, state);
    set({
      selectedFile: prevFilePath,
      focusedHunkId: hunkId,
      scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
    });
  },

  nextHunk: () => {
    const state = get();
    const { hunks } = state;
    if (hunks.length === 0) return;
    const currentIndex = focusedHunkPosition(state);
    for (let i = currentIndex + 1; i < hunks.length; i++) {
      if (!isHunkTrustedInState(hunks[i].id, state)) {
        set({
          focusedHunkId: hunks[i].id,
          selectedFile: hunks[i].filePath,
          scrollTarget: { type: "hunk", hunkId: hunks[i].id },
        });
        return;
      }
    }
  },

  prevHunk: () => {
    const state = get();
    const { hunks } = state;
    if (hunks.length === 0) return;
    const currentIndex = focusedHunkPosition(state);
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (!isHunkTrustedInState(hunks[i].id, state)) {
        set({
          focusedHunkId: hunks[i].id,
          selectedFile: hunks[i].filePath,
          scrollTarget: { type: "hunk", hunkId: hunks[i].id },
        });
        return;
      }
    }
  },

  // Guide content mode
  setGuideContentMode: (mode) => set({ guideContentMode: mode }),

  // Changes view mode
  setChangesViewMode: (mode) => set({ changesViewMode: mode }),

  navigateToBrowse: (filePath?) => {
    if (filePath === undefined) {
      set({ guideContentMode: null, viewingCommitHash: null });
      return;
    }

    const state = get();
    const hunkId = findFirstUnreviewedHunkId(filePath, state);

    set({
      guideContentMode: null,
      viewingCommitHash: null,
      selectedFile: filePath,
      filesPanelCollapsed: false,
      ...(hunkId && {
        focusedHunkId: hunkId,
        scrollTarget: { type: "hunk", hunkId },
      }),
    });
  },

  revealInBrowse: (filePath) => {
    set({
      viewingCommitHash: null,
      requestedFilesPanelTab: "browse",
      fileToReveal: filePath,
      selectedFile: filePath,
      filesPanelCollapsed: false,
    });
  },

  // Split view actions
  setSecondaryFile: (path) => set({ secondaryFile: path }),

  setFocusedPane: (pane) =>
    set({ focusedPane: pane, focusedHunkId: null, scrollTarget: null }),

  setSplitOrientation: (orientation) => set({ splitOrientation: orientation }),

  openInSplit: (path) => {
    const state = get();
    const hunkId = findFirstUnreviewedHunkId(path, state);
    if (state.selectedFile === null) {
      set({
        selectedFile: path,
        focusedHunkId: hunkId,
        scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
      });
    } else {
      set({
        secondaryFile: path,
        focusedPane: "secondary",
        focusedHunkId: hunkId,
        scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
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
    const { hunks } = state;
    if (hunks.length === 0) return;
    const currentIndex = focusedHunkPosition(state);
    const currentHunk = currentIndex >= 0 ? hunks[currentIndex] : null;
    if (!currentHunk) return;
    for (let i = currentIndex + 1; i < hunks.length; i++) {
      if (hunks[i].filePath !== currentHunk.filePath) break;
      if (!isHunkTrustedInState(hunks[i].id, state)) {
        set({
          focusedHunkId: hunks[i].id,
          scrollTarget: { type: "hunk", hunkId: hunks[i].id },
        });
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

  // Working tree diff (Git panel file selection)
  workingTreeDiffFile: null,
  workingTreeDiffMode: null,
  selectWorkingTreeFile: (path, mode) => {
    const hunkId = findFirstUnreviewedHunkId(path, get());
    set({
      selectedFile: path,
      workingTreeDiffFile: path,
      workingTreeDiffMode: mode ?? "unstaged",
      focusedHunkId: hunkId,
      scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
      guideContentMode: null,
    });
  },

  swapPanes: () => {
    const { selectedFile, secondaryFile } = get();
    set({
      selectedFile: secondaryFile,
      secondaryFile: selectedFile,
      focusedHunkId: null,
      scrollTarget: null,
    });
  },

  // Active group index
  activeGroupIndex: 0,
  setActiveGroupIndex: (index) => set({ activeGroupIndex: index }),

  // Ad-hoc group
  adhocGroup: null,

  // Viewing a commit diff inline
  viewingCommitHash: null,
  setViewingCommitHash: (hash) => set({ viewingCommitHash: hash }),

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
