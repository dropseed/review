import { useEffect, useCallback } from "react";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";
import type { DiffHunk } from "../types";

interface UseKeyboardNavigationOptions {
  hunks: DiffHunk[];
  focusedHunkIndex: number;
  nextFile: () => void;
  prevFile: () => void;
  nextHunk: () => void;
  prevHunk: () => void;
  approveHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string) => void;
  handleOpenRepo: () => void;
  codeFontSize: number;
  setCodeFontSize: (size: number) => void;
  secondaryFile: string | null;
  closeSplit: () => void;
  setSplitOrientation: (orientation: "horizontal" | "vertical") => void;
  splitOrientation: "horizontal" | "vertical";
  setShowDebugModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowFileFinder: (show: boolean) => void;
}

/**
 * Handles keyboard navigation and shortcuts.
 * j/k for hunk navigation, a/r for approve/reject, modal toggles, font size, split view.
 */
export function useKeyboardNavigation({
  hunks,
  focusedHunkIndex,
  nextFile,
  prevFile,
  nextHunk,
  prevHunk,
  approveHunk,
  rejectHunk,
  handleOpenRepo,
  codeFontSize,
  setCodeFontSize,
  secondaryFile,
  closeSplit,
  setSplitOrientation,
  splitOrientation,
  setShowDebugModal,
  setShowSettingsModal,
  setShowFileFinder,
}: UseKeyboardNavigationOptions) {
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

      // Cmd/Ctrl+P to open file finder
      if ((event.metaKey || event.ctrlKey) && event.key === "p") {
        event.preventDefault();
        setShowFileFinder(true);
        return;
      }

      // Escape to close split view (only when split is active)
      if (event.key === "Escape" && secondaryFile !== null) {
        event.preventDefault();
        closeSplit();
        return;
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

      switch (event.key) {
        case "j":
          // Navigate to next hunk (handles file switching automatically)
          nextHunk();
          break;
        case "k":
          // Navigate to previous hunk (handles file switching automatically)
          prevHunk();
          break;
        case "a":
          // Approve focused hunk
          if (hunks.length > 0 && focusedHunkIndex < hunks.length) {
            const focusedHunk = hunks[focusedHunkIndex];
            approveHunk(focusedHunk.id);
          }
          break;
        case "r":
          // Reject focused hunk
          if (hunks.length > 0 && focusedHunkIndex < hunks.length) {
            const focusedHunk = hunks[focusedHunkIndex];
            rejectHunk(focusedHunk.id);
          }
          break;
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
      handleOpenRepo,
      codeFontSize,
      setCodeFontSize,
      secondaryFile,
      closeSplit,
      setSplitOrientation,
      splitOrientation,
      setShowDebugModal,
      setShowSettingsModal,
      setShowFileFinder,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
