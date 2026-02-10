import { useEffect, useCallback } from "react";
import { useReviewStore } from "../stores";

/**
 * Handles keyboard navigation and shortcuts.
 * j/k for hunk navigation, a/r for approve/reject, split view, escape.
 *
 * Note: Shortcuts that have Tauri menu accelerators (Cmd+P, Cmd+R,
 * Cmd+Shift+F, Cmd+Shift+N, Cmd+B, Cmd+Shift+D, Cmd+,,
 * Cmd+0, Cmd+=, Cmd+-) are handled exclusively via useMenuEvents to avoid
 * double-firing.
 */
export function useKeyboardNavigation() {
  const hunks = useReviewStore((s) => s.hunks);
  const focusedHunkIndex = useReviewStore((s) => s.focusedHunkIndex);
  const nextHunk = useReviewStore((s) => s.nextHunk);
  const prevHunk = useReviewStore((s) => s.prevHunk);
  const approveHunk = useReviewStore((s) => s.approveHunk);
  const rejectHunk = useReviewStore((s) => s.rejectHunk);
  const setPendingCommentHunkId = useReviewStore(
    (s) => s.setPendingCommentHunkId,
  );
  const nextHunkInFile = useReviewStore((s) => s.nextHunkInFile);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const closeSplit = useReviewStore((s) => s.closeSplit);
  const setSplitOrientation = useReviewStore((s) => s.setSplitOrientation);
  const splitOrientation = useReviewStore((s) => s.splitOrientation);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const navigateToGuide = useReviewStore((s) => s.navigateToGuide);
  const undo = useReviewStore((s) => s.undo);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't capture keys when typing in inputs
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Cmd/Ctrl+O is handled globally by AppShell
      // Cmd/Ctrl+P, Cmd/Ctrl+R, Cmd/Ctrl+Shift+F, Cmd/Ctrl+Shift+N, Cmd/Ctrl+B
      // are handled via Tauri menu accelerators + useMenuEvents
      // Cmd/Ctrl+Shift+D, Cmd/Ctrl+, are handled via Tauri menu accelerators + useMenuEvents

      // Cmd/Ctrl+F to block browser find (in-file search handled by FileViewer)
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key === "f"
      ) {
        event.preventDefault();
        return;
      }

      // Escape: close split → toggle between browse and guide
      if (event.key === "Escape") {
        if (secondaryFile !== null) {
          event.preventDefault();
          closeSplit();
          return;
        }
        if (topLevelView === "browse") {
          event.preventDefault();
          navigateToGuide();
          return;
        }
        if (topLevelView === "guide") {
          event.preventDefault();
          navigateToBrowse();
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

      // Cmd/Ctrl+0, Cmd/Ctrl+=, Cmd/Ctrl+- are handled via Tauri menu accelerators + useMenuEvents

      // Don't handle single-key shortcuts when modifier keys are held
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key) {
        case "j":
          // In overview, switch to browse first
          if (topLevelView === "guide") {
            navigateToBrowse();
          }
          // Navigate to next hunk (handles file switching automatically)
          nextHunk();
          break;
        case "k":
          // In overview, switch to browse first
          if (topLevelView === "guide") {
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
        case "z":
          undo();
          break;
      }
    },
    [
      nextHunk,
      prevHunk,
      hunks,
      focusedHunkIndex,
      approveHunk,
      rejectHunk,
      setPendingCommentHunkId,
      nextHunkInFile,
      secondaryFile,
      closeSplit,
      setSplitOrientation,
      splitOrientation,
      topLevelView,
      navigateToBrowse,
      navigateToGuide,
      undo,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
