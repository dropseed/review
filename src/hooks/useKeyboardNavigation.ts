import { useEffect, useCallback } from "react";
import { useReviewStore } from "../stores";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";

interface UseKeyboardNavigationOptions {
  handleOpenRepo: () => void;
  onBack: () => void;
  setShowDebugModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowFileFinder: (show: boolean) => void;
  setShowContentSearch: (show: boolean) => void;
  setShowSymbolSearch: (show: boolean) => void;
  toggleReviewsSidebar?: () => void;
}

/**
 * Handles keyboard navigation and shortcuts.
 * j/k for hunk navigation, a/r for approve/reject, modal toggles, font size, split view.
 */
export function useKeyboardNavigation({
  handleOpenRepo,
  onBack,
  setShowDebugModal,
  setShowSettingsModal,
  setShowFileFinder,
  setShowContentSearch,
  setShowSymbolSearch,
  toggleReviewsSidebar,
}: UseKeyboardNavigationOptions) {
  const hunks = useReviewStore((s) => s.hunks);
  const focusedHunkIndex = useReviewStore((s) => s.focusedHunkIndex);
  const nextFile = useReviewStore((s) => s.nextFile);
  const prevFile = useReviewStore((s) => s.prevFile);
  const nextHunk = useReviewStore((s) => s.nextHunk);
  const prevHunk = useReviewStore((s) => s.prevHunk);
  const approveHunk = useReviewStore((s) => s.approveHunk);
  const rejectHunk = useReviewStore((s) => s.rejectHunk);
  const setPendingCommentHunkId = useReviewStore(
    (s) => s.setPendingCommentHunkId,
  );
  const nextHunkInFile = useReviewStore((s) => s.nextHunkInFile);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const setCodeFontSize = useReviewStore((s) => s.setCodeFontSize);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const closeSplit = useReviewStore((s) => s.closeSplit);
  const setSplitOrientation = useReviewStore((s) => s.setSplitOrientation);
  const splitOrientation = useReviewStore((s) => s.splitOrientation);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const navigateToOverview = useReviewStore((s) => s.navigateToOverview);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't capture keys when typing in inputs
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Cmd/Ctrl+O to open repository
      if ((event.metaKey || event.ctrlKey) && event.key === "o") {
        event.preventDefault();
        handleOpenRepo();
        return;
      }

      // Cmd/Ctrl+Shift+D to open debug modal
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "d"
      ) {
        event.preventDefault();
        setShowDebugModal(true);
        return;
      }

      // Cmd/Ctrl+, to open settings modal
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setShowSettingsModal(true);
        return;
      }

      // Cmd/Ctrl+E to toggle reviews sidebar
      if ((event.metaKey || event.ctrlKey) && event.key === "e") {
        event.preventDefault();
        toggleReviewsSidebar?.();
        return;
      }

      // Cmd/Ctrl+P to open file finder
      if ((event.metaKey || event.ctrlKey) && event.key === "p") {
        event.preventDefault();
        setShowFileFinder(true);
        return;
      }

      // Cmd/Ctrl+R to open symbol search (only when viewing a file)
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key === "r" &&
        topLevelView === "browse"
      ) {
        event.preventDefault();
        setShowSymbolSearch(true);
        return;
      }

      // Cmd/Ctrl+F to block browser find (in-file search handled by FileViewer)
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key === "f"
      ) {
        event.preventDefault();
        return;
      }

      // Cmd/Ctrl+Shift+F to open content search
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "f"
      ) {
        event.preventDefault();
        setShowContentSearch(true);
        return;
      }

      // Escape: close split → browse to overview → overview to start screen
      if (event.key === "Escape") {
        if (secondaryFile !== null) {
          event.preventDefault();
          closeSplit();
          return;
        }
        if (topLevelView === "browse") {
          event.preventDefault();
          navigateToOverview();
          return;
        }
        if (topLevelView === "overview") {
          event.preventDefault();
          onBack();
          return;
        }
      }

      // Cmd/Ctrl+Shift+\ to toggle split orientation
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "\\"
      ) {
        event.preventDefault();
        setSplitOrientation(
          splitOrientation === "horizontal" ? "vertical" : "horizontal",
        );
        return;
      }

      // Cmd/Ctrl++ to increase font size
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "=" || event.key === "+")
      ) {
        event.preventDefault();
        const newSize = Math.min(
          codeFontSize + CODE_FONT_SIZE_STEP,
          CODE_FONT_SIZE_MAX,
        );
        setCodeFontSize(newSize);
        return;
      }

      // Cmd/Ctrl+- to decrease font size
      if ((event.metaKey || event.ctrlKey) && event.key === "-") {
        event.preventDefault();
        const newSize = Math.max(
          codeFontSize - CODE_FONT_SIZE_STEP,
          CODE_FONT_SIZE_MIN,
        );
        setCodeFontSize(newSize);
        return;
      }

      // Cmd/Ctrl+0 to reset font size to default
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        setCodeFontSize(CODE_FONT_SIZE_DEFAULT);
        return;
      }

      // Don't handle single-key shortcuts when modifier keys are held
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key) {
        case "j":
          // In overview, switch to browse first
          if (topLevelView === "overview") {
            navigateToBrowse();
          }
          // Navigate to next hunk (handles file switching automatically)
          nextHunk();
          break;
        case "k":
          // In overview, switch to browse first
          if (topLevelView === "overview") {
            navigateToBrowse();
          }
          // Navigate to previous hunk (handles file switching automatically)
          prevHunk();
          break;
        case "a":
        case "r": {
          const focusedHunk = hunks[focusedHunkIndex];
          if (!focusedHunk) break;
          if (event.key === "a") {
            approveHunk(focusedHunk.id);
            nextHunkInFile();
          } else {
            rejectHunk(focusedHunk.id);
            setPendingCommentHunkId(focusedHunk.id);
          }
          break;
        }
        case "ArrowDown":
          if (event.metaKey || event.ctrlKey) {
            nextFile();
            event.preventDefault();
          }
          break;
        case "ArrowUp":
          if (event.metaKey || event.ctrlKey) {
            prevFile();
            event.preventDefault();
          }
          break;
      }
    },
    [
      nextFile,
      prevFile,
      nextHunk,
      prevHunk,
      hunks,
      focusedHunkIndex,
      approveHunk,
      rejectHunk,
      setPendingCommentHunkId,
      nextHunkInFile,
      handleOpenRepo,
      onBack,
      codeFontSize,
      setCodeFontSize,
      secondaryFile,
      closeSplit,
      setSplitOrientation,
      splitOrientation,
      setShowDebugModal,
      setShowSettingsModal,
      setShowFileFinder,
      setShowContentSearch,
      setShowSymbolSearch,
      toggleReviewsSidebar,
      topLevelView,
      navigateToBrowse,
      navigateToOverview,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
