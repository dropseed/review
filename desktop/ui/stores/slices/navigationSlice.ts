import { isHunkReviewed } from "../../types";
import type { DiffHunk, HunkGroup } from "../../types";
import {
  shouldSkipHunkForNavigation,
  type ReviewScope,
} from "../../types/scope";
import type { ReviewStore, SliceCreator } from "../types";
import { getHunkLocationMap } from "../selectors/hunks";

export type FocusedPane = "primary" | "secondary";
export type SplitOrientation = "horizontal" | "vertical";
export type GuideContentMode = "group" | "adhoc-group" | null;

export type ScrollTarget =
  | { type: "hunk"; hunkId: string }
  | { type: "line"; filePath: string; lineNumber: number };

export interface NavigationSlice {
  // Navigation state
  selectedFile: string | null;
  focusedHunkId: string | null;
  scrollTarget: ScrollTarget | null;
  clearScrollTarget: () => void;

  /**
   * A deep-link target waiting for hunks to load. When the route navigates
   * before `filesByPath` is populated (e.g. cold-start review:// deep links),
   * setting `selectedFile`/`scrollTarget` immediately is a no-op because the
   * hunk isn't in the store yet. A separate effect consumes this once hunks
   * arrive and forwards the focus to `selectedFile` + `scrollTarget`.
   */
  pendingDeepLinkFocus: { filePath: string; hunkHash: string | null } | null;
  setPendingDeepLinkFocus: (
    focus: { filePath: string; hunkHash: string | null } | null,
  ) => void;

  /** Absolute path to an external file (outside the repo) being viewed read-only. */
  externalFilePath: string | null;
  setExternalFile: (path: string | null, lineNumber?: number) => void;

  /** History stack for external file navigation (back button). */
  externalFileHistory: Array<{ path: string; line?: number }>;
  goBackExternalFile: () => void;

  // Guide content mode: what ContentArea shows when guide content is active
  guideContentMode: GuideContentMode;
  setGuideContentMode: (mode: GuideContentMode) => void;

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
  navigateToBrowse: (filePath?: string, scrollTo?: { hunkId: string }) => void;
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

  // Jump to first/last hunk in the current file
  firstHunkInFile: () => void;
  lastHunkInFile: () => void;

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

  // Review scope: a named, exact hunk-ID set (a status bucket, a commit, the
  // uncommitted bucket, or a guide group). Set by clicking a group header,
  // the walk bar, or a provenance tag; composes with `reviewFilter` (AND) to
  // gate the Review-tab file list, navigation, and the diff viewer's
  // out-of-scope collapsing.
  scope: ReviewScope | null;
  setScope: (scope: ReviewScope | null) => void;

  // Guide mode: swaps the Review-tab sidebar to the guide's ordered-section
  // walkthrough (back button + numbered sections), replacing the commit
  // picker and status sections. Entered via GuideBanner (which also jumps
  // into the first incomplete section), exited via the back button — which
  // also clears any guide scope and guide content mode so the user lands
  // back on a clean normal review.
  guideMode: boolean;
  setGuideMode: (on: boolean) => void;

  // Working tree diff (Git panel file selection)
  workingTreeDiffFile: string | null;
  workingTreeDiffMode: "staged" | "unstaged" | null;
  selectWorkingTreeFile: (path: string, mode?: "staged" | "unstaged") => void;

  // Active group index in focused review section
  activeGroupIndex: number;
  setActiveGroupIndex: (index: number) => void;

  // Ad-hoc hunk group (used with guideContentMode "adhoc-group")
  adhocGroup: HunkGroup | null;
  /**
   * Show a one-off HunkGroup in MultiFileDiffViewer without changing the
   * generated review groups. Used for trust-pattern previews and the
   * Files-panel "view as rolling diff" buttons.
   */
  openAdhocGroup: (group: HunkGroup) => void;

  // Working-tree rolling diff (Git panel section "view as rolling diff").
  // When set, ContentArea renders WorkingTreeMultiFileDiffViewer, which
  // derives the file list from the live gitStatus for the requested mode.
  workingTreeMultiView: {
    title: string;
    mode: "staged" | "unstaged";
  } | null;
  openWorkingTreeMultiView: (view: {
    title: string;
    mode: "staged" | "unstaged";
  }) => void;
  closeWorkingTreeMultiView: () => void;

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

  // File-visit history for the mouse back/forward buttons: a linear stack of
  // recently viewed file paths with a cursor. Mouse buttons 3/4 step it to
  // jump back/forward between files.
  fileNavHistory: string[];
  fileNavIndex: number;
  /** Record a file visit; dedupes the current entry and drops forward history. */
  recordFileVisit: (path: string) => void;
  /** Step the file-visit history back (-1) or forward (+1). */
  navigateFileHistory: (direction: -1 | 1) => void;
}

/** Check whether a hunk is unreviewed for the given file's review context. */
function isHunkUnreviewedFor(
  filePath: string,
  state: ReviewStore,
): (h: DiffHunk) => boolean {
  const { reviewState, stagedFilePaths } = state;
  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;

  return (h) => {
    const hunkState = reviewState?.hunks[h.id];
    return !isHunkReviewed(hunkState, trustList, {
      autoApproveStaged,
      stagedFilePaths,
      filePath,
    });
  };
}

/**
 * Find the ID of the first unreviewed hunk for a file, falling back to the
 * first hunk in the file if all are reviewed. Returns null if no hunks.
 */
export function findFirstUnreviewedHunkId(
  filePath: string,
  state: ReviewStore,
): string | null {
  const fileHunks = state.filesByPath[filePath]?.hunks ?? [];
  const unreviewed = fileHunks.find(isHunkUnreviewedFor(filePath, state));
  if (unreviewed) return unreviewed.id;
  return fileHunks[0]?.id ?? null;
}

/** Locate the focused hunk via the cached hunkId → location map. O(1). */
function focusedHunkLocation(
  state: ReviewStore,
): { filePath: string; indexInFile: number } | null {
  if (!state.focusedHunkId) return null;
  return getHunkLocationMap(state.filesByPath).get(state.focusedHunkId) ?? null;
}

/** Check whether a file has any unreviewed hunks. */
function fileHasUnreviewedHunks(filePath: string, state: ReviewStore): boolean {
  const fileHunks = state.filesByPath[filePath]?.hunks ?? [];
  return fileHunks.some(isHunkUnreviewedFor(filePath, state));
}

/** Bind {@link shouldSkipHunkForNavigation} to the current store state. */
function shouldSkipHunkInState(hunkId: string, state: ReviewStore): boolean {
  const { reviewState, scope } = state;
  return shouldSkipHunkForNavigation({
    hunkId,
    hunkState: reviewState?.hunks[hunkId],
    trustList: reviewState?.trustList ?? [],
    scope,
  });
}

/**
 * Field set that nulls out every "overlay" view in the content area, used to
 * keep the overlays mutually exclusive. ContentArea picks guideContentMode >
 * workingTreeMultiView > file viewer, but if two are set at once the
 * lower-priority one leaks state when the higher one is dismissed. Any
 * action that opens or dismisses one overlay should spread these in to
 * clear the others.
 */
const OVERLAYS_CLEARED = {
  guideContentMode: null,
  adhocGroup: null,
  workingTreeMultiView: null,
} as const;

/** Jump to the first or last hunk in the current file. */
function jumpToFileEdge(
  get: () => ReviewStore,
  set: (partial: Partial<ReviewStore>) => void,
  edge: "first" | "last",
): void {
  const { filesByPath, selectedFile } = get();
  if (!selectedFile) return;

  const fileHunks = filesByPath[selectedFile]?.hunks ?? [];
  const target =
    edge === "first" ? fileHunks[0] : fileHunks[fileHunks.length - 1];

  if (target) {
    set({
      focusedHunkId: target.id,
      scrollTarget: { type: "hunk", hunkId: target.id },
    });
  }
}

export const createNavigationSlice: SliceCreator<NavigationSlice> = (
  set,
  get,
) => ({
  selectedFile: null,
  focusedHunkId: null,
  scrollTarget: null,
  clearScrollTarget: () => set({ scrollTarget: null }),

  pendingDeepLinkFocus: null,
  setPendingDeepLinkFocus: (focus) => set({ pendingDeepLinkFocus: focus }),

  externalFilePath: null,
  externalFileHistory: [],
  setExternalFile: (path, lineNumber) => {
    if (path) {
      const { externalFilePath, externalFileHistory } = get();
      // Push current external file onto history stack (if one is open)
      const nextHistory =
        externalFilePath !== null
          ? [...externalFileHistory, { path: externalFilePath }]
          : externalFileHistory;
      set({
        externalFilePath: path,
        externalFileHistory: nextHistory,
        // Don't clear selectedFile — we'll restore it when the user navigates back
        scrollTarget: lineNumber
          ? { type: "line", filePath: path, lineNumber }
          : null,
      });
    } else {
      set({ externalFilePath: null, externalFileHistory: [] });
    }
  },

  goBackExternalFile: () => {
    const { externalFileHistory } = get();
    if (externalFileHistory.length === 0) {
      set({ externalFilePath: null });
      return;
    }
    const entry = externalFileHistory[externalFileHistory.length - 1];
    set({
      externalFilePath: entry.path,
      externalFileHistory: externalFileHistory.slice(0, -1),
      scrollTarget: entry.line
        ? { type: "line", filePath: entry.path, lineNumber: entry.line }
        : null,
    });
  },

  // Guide content mode
  guideContentMode: null,

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
      externalFilePath: null as string | null,
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
    const { filesByPath, flatFileList } = state;
    const loc = focusedHunkLocation(state);

    // Walk hunks forward starting from after the focused hunk. If there's no
    // focus, start from the first file. Crosses file boundaries in
    // `flatFileList` order.
    const startFileIdx = loc ? flatFileList.indexOf(loc.filePath) : 0;
    const startInFileIdx = loc ? loc.indexInFile + 1 : 0;
    if (startFileIdx === -1) return;

    for (let fi = startFileIdx; fi < flatFileList.length; fi++) {
      const filePath = flatFileList[fi];
      const fileHunks = filesByPath[filePath]?.hunks;
      if (!fileHunks) continue;
      const start = fi === startFileIdx ? startInFileIdx : 0;
      for (let i = start; i < fileHunks.length; i++) {
        if (!shouldSkipHunkInState(fileHunks[i].id, state)) {
          set({
            focusedHunkId: fileHunks[i].id,
            selectedFile: filePath,
            scrollTarget: { type: "hunk", hunkId: fileHunks[i].id },
          });
          return;
        }
      }
    }
  },

  prevHunk: () => {
    const state = get();
    const { filesByPath, flatFileList } = state;
    const loc = focusedHunkLocation(state);

    // Match the pre-reshape behavior: prevHunk with no focused hunk is a
    // no-op. (nextHunk with no focus jumps to the first hunk; the asymmetry
    // mirrors how the old flat-array code naturally fell through when
    // currentIndex was -1.)
    if (!loc) return;

    const startFileIdx = flatFileList.indexOf(loc.filePath);
    if (startFileIdx === -1) return;
    const startInFileIdx = loc.indexInFile - 1;

    for (let fi = startFileIdx; fi >= 0; fi--) {
      const filePath = flatFileList[fi];
      const fileHunks = filesByPath[filePath]?.hunks;
      if (!fileHunks) continue;
      const start = fi === startFileIdx ? startInFileIdx : fileHunks.length - 1;
      for (let i = start; i >= 0; i--) {
        if (!shouldSkipHunkInState(fileHunks[i].id, state)) {
          set({
            focusedHunkId: fileHunks[i].id,
            selectedFile: filePath,
            scrollTarget: { type: "hunk", hunkId: fileHunks[i].id },
          });
          return;
        }
      }
    }
  },

  // Guide content mode
  setGuideContentMode: (mode) => set({ guideContentMode: mode }),

  navigateToBrowse: (filePath?, scrollTo?) => {
    if (filePath === undefined) {
      set({ ...OVERLAYS_CLEARED });
      return;
    }

    if (scrollTo) {
      // Caller provides a specific hunk — set focusedHunkId but let the
      // caller control scrollTarget (e.g. type "line" for a highlight).
      set({
        ...OVERLAYS_CLEARED,
        selectedFile: filePath,
        filesPanelCollapsed: false,
        focusedHunkId: scrollTo.hunkId,
      });
      return;
    }

    // Default: auto-scroll to the first unreviewed hunk.
    const hunkId = findFirstUnreviewedHunkId(filePath, get());

    set({
      ...OVERLAYS_CLEARED,
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
      ...OVERLAYS_CLEARED,
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

  // Jump to first/last hunk in the current file
  firstHunkInFile: () => jumpToFileEdge(get, set, "first"),
  lastHunkInFile: () => jumpToFileEdge(get, set, "last"),

  // Advance to next hunk within the same file, skipping trusted/out-of-scope hunks
  nextHunkInFile: () => {
    const state = get();
    const loc = focusedHunkLocation(state);
    if (!loc) return;
    const fileHunks = state.filesByPath[loc.filePath]?.hunks ?? [];
    for (let i = loc.indexInFile + 1; i < fileHunks.length; i++) {
      if (!shouldSkipHunkInState(fileHunks[i].id, state)) {
        set({
          focusedHunkId: fileHunks[i].id,
          scrollTarget: { type: "hunk", hunkId: fileHunks[i].id },
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

  scope: null,
  setScope: (scope) => set({ scope }),

  guideMode: false,
  setGuideMode: (on) => {
    if (on) return set({ guideMode: true });
    set((state) => ({
      guideMode: false,
      guideContentMode: null,
      scope: state.scope?.source === "guide" ? null : state.scope,
    }));
  },

  // Working tree diff (Git panel file selection)
  workingTreeDiffFile: null,
  workingTreeDiffMode: null,
  selectWorkingTreeFile: (path, mode) => {
    const hunkId = findFirstUnreviewedHunkId(path, get());
    set({
      ...OVERLAYS_CLEARED,
      selectedFile: path,
      workingTreeDiffFile: path,
      workingTreeDiffMode: mode ?? "unstaged",
      focusedHunkId: hunkId,
      scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
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
  openAdhocGroup: (group) =>
    set({
      ...OVERLAYS_CLEARED,
      adhocGroup: group,
      guideContentMode: "adhoc-group",
      selectedFile: null,
    }),

  // Working-tree multi-file rolling diff
  workingTreeMultiView: null,
  openWorkingTreeMultiView: (view) =>
    set({
      ...OVERLAYS_CLEARED,
      workingTreeMultiView: view,
      selectedFile: null,
      workingTreeDiffFile: null,
      workingTreeDiffMode: null,
    }),
  closeWorkingTreeMultiView: () => set({ workingTreeMultiView: null }),

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

  // File-visit history (mouse back/forward buttons)
  fileNavHistory: [],
  fileNavIndex: -1,
  recordFileVisit: (path) => {
    const { fileNavHistory, fileNavIndex } = get();
    // Already the current entry — re-selecting the same file, or the change
    // came from navigateFileHistory itself (which moved the cursor first).
    if (fileNavHistory[fileNavIndex] === path) return;
    // Drop any forward history, append, and cap the stack.
    const next = fileNavHistory.slice(0, fileNavIndex + 1);
    next.push(path);
    const capped = next.slice(-50);
    set({ fileNavHistory: capped, fileNavIndex: capped.length - 1 });
  },
  navigateFileHistory: (direction) => {
    const { fileNavHistory, fileNavIndex, navigateToBrowse } = get();
    const target = fileNavIndex + direction;
    if (target < 0 || target >= fileNavHistory.length) return;
    // Move the cursor first so recordFileVisit sees the target as the current
    // entry and skips re-recording when selectedFile updates below.
    set({ fileNavIndex: target });
    navigateToBrowse(fileNavHistory[target]);
  },
});
