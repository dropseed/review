import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { getAllHunksFromState } from "../stores/selectors/hunks";
import type { Comparison } from "../types";
import type { ActiveReviewKey } from "../stores/slices/tabRailSlice";
import {
  buildRepoGroups,
  flattenRepoGroups,
  type SidebarEntry,
} from "../utils/sidebar-ordering";

interface SidebarItem {
  key: string;
  reviewKey: ActiveReviewKey;
  comparison: Comparison;
}

function entriesToItems(entries: SidebarEntry[]): SidebarItem[] {
  return entries.map((entry) => {
    if (entry.kind === "review") {
      return {
        key: entry.reviewKey,
        reviewKey: {
          repoPath: entry.review.repoPath,
          comparisonKey: entry.review.comparison.key,
        },
        comparison: entry.review.comparison,
      };
    }
    return {
      key: entry.reviewKey,
      reviewKey: {
        repoPath: entry.repo.repoPath,
        comparisonKey: entry.comparison.key,
      },
      comparison: entry.comparison,
    };
  });
}

/** Activate a sidebar item: save snapshot, switch review/comparison. */
function activateSidebarItem(
  state: ReturnType<typeof useReviewStore.getState>,
  item: SidebarItem,
): void {
  state.saveNavigationSnapshot();
  state.setActiveReviewKey(item.reviewKey);
  if (item.reviewKey.repoPath !== state.repoPath) {
    state.switchReview(item.reviewKey.repoPath, item.comparison);
  } else {
    state.setComparison(item.comparison);
  }
}

/**
 * Handles keyboard navigation and shortcuts.
 * j/k for hunk navigation, a/r for approve/reject, split view, escape.
 *
 * Note: Shortcuts that have Tauri menu accelerators (Cmd+P, Cmd+R,
 * Cmd+Shift+F, Cmd+Shift+N, Cmd+B, Cmd+,,
 * Cmd+0, Cmd+=, Cmd+-) are handled exclusively via useMenuEvents to avoid
 * double-firing.
 */
export function useKeyboardNavigation() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
      // Cmd/Ctrl+, is handled via Tauri menu accelerators + useMenuEvents

      // Cmd/Ctrl+F to block browser find (in-file search handled by FileViewer)
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key === "f"
      ) {
        event.preventDefault();
        return;
      }

      const state = useReviewStore.getState();

      // Escape: dismiss commit view first, then close split view
      if (event.key === "Escape" && state.viewingCommitHash !== null) {
        event.preventDefault();
        state.setViewingCommitHash(null);
        return;
      }
      if (event.key === "Escape" && state.secondaryFile !== null) {
        event.preventDefault();
        state.closeSplit();
        return;
      }

      // Cmd/Ctrl+Shift+\ to toggle split orientation
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "\\"
      ) {
        event.preventDefault();
        state.setSplitOrientation(
          state.splitOrientation === "horizontal" ? "vertical" : "horizontal",
        );
        return;
      }

      // Cmd/Ctrl+D: split side-by-side (horizontal layout).
      // Cmd/Ctrl+Shift+D: split stacked (vertical layout).
      // If already split, just adjust the orientation.
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "d" || event.key === "D")
      ) {
        event.preventDefault();
        const orientation = event.shiftKey ? "vertical" : "horizontal";
        state.setSplitOrientation(orientation);
        if (state.secondaryFile === null) {
          state.openEmptySplit();
        }
        return;
      }

      // Cmd/Ctrl+0, Cmd/Ctrl+=, Cmd/Ctrl+- are handled via Tauri menu accelerators + useMenuEvents

      // Cmd+ArrowUp / Cmd+ArrowDown: jump to first/last hunk in current file
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          state.firstHunkInFile();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          state.lastHunkInFile();
          return;
        }

        // Cmd+1 through Cmd+9: jump to sidebar item by position
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          event.preventDefault();
          const items = entriesToItems(
            flattenRepoGroups(
              buildRepoGroups(
                state.localActivity,
                state.globalReviews,
                state.globalReviewsByKey,
                state.reviewSortOrder,
                state.reviewDiffStats,
              ),
            ),
          );
          const target = items[digit - 1];
          if (target) activateSidebarItem(state, target);
          return;
        }
      }

      // Don't handle single-key shortcuts when modifier keys are held
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key) {
        case "j":
          // In guide content, switch to browse first
          if (state.guideContentMode !== null) {
            state.navigateToBrowse();
          }
          // Navigate to next hunk (handles file switching automatically)
          state.nextHunk();
          break;
        case "k":
          // In guide content, switch to browse first
          if (state.guideContentMode !== null) {
            state.navigateToBrowse();
          }
          // Navigate to previous hunk (handles file switching automatically)
          state.prevHunk();
          break;
        case "a":
        case "r":
        case "s": {
          const focusedHunk = state.focusedHunkId
            ? getAllHunksFromState(state).find(
                (h) => h.id === state.focusedHunkId,
              )
            : null;
          if (!focusedHunk) break;
          if (event.key === "a") {
            state.approveHunk(focusedHunk.id);
            state.nextHunkInFile();
          } else if (event.key === "r") {
            state.rejectHunk(focusedHunk.id);
            state.setPendingCommentHunkId(focusedHunk.id);
          } else {
            state.saveHunkForLater(focusedHunk.id);
          }
          break;
        }
        case "z":
          state.undo();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
