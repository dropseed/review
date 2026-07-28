import { useEffect } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { getMissingRefs } from "../stores/slices/groupingSlice";
import { getAllHunksFromState } from "../stores/selectors/hunks";
import { type SplitDirection } from "../components/Terminal/pane-tree";
import { focusedTerminalTab } from "../components/Terminal/close";
import {
  buildSidebarTree,
  flattenSidebarTree,
  type SidebarRow,
} from "../utils/sidebar-tree";

interface SidebarItem {
  key: string;
  repoPath: string;
  ref: string;
  baseOverride?: string;
}

function rowsToItems(rows: SidebarRow[]): SidebarItem[] {
  return rows.map((row) => ({
    key: row.reviewKey,
    repoPath: row.repoPath,
    ref: row.ref,
    baseOverride:
      row.entry.kind === "review" ? row.entry.review.baseOverride : undefined,
  }));
}

/** Activate a sidebar item: save snapshot, resolve the ref, switch review. */
function activateSidebarItem(
  state: ReturnType<typeof useReviewStore.getState>,
  item: SidebarItem,
): void {
  state.saveNavigationSnapshot();
  void (async () => {
    const resolved = await getApiClient().resolveReview(
      item.repoPath,
      item.ref,
      item.baseOverride,
    );
    state.setActiveReviewKey({ repoPath: item.repoPath, ref: item.ref });
    if (item.repoPath !== useReviewStore.getState().repoPath) {
      state.switchReview(item.repoPath, resolved);
    } else {
      state.setComparison(resolved);
    }
  })();
}

/**
 * Split the terminal pane that currently has focus, if any. Returns whether it
 * handled the keystroke, so the caller can fall through to the diff-view split.
 *
 * The tab is resolved from the focused pane rather than from the review being
 * viewed: a pinned tab is shown from every repo, so "the tab on screen" and
 * "the tab in this review's bucket" are not the same question.
 */
function splitFocusedTerminal(direction: SplitDirection): boolean {
  const focused = focusedTerminalTab();
  if (!focused) return false;
  void useReviewStore
    .getState()
    .splitTerminal(
      focused.reviewKey,
      focused.tab.id,
      focused.terminalId,
      direction,
    );
  return true;
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
      // Cmd+D/Cmd+Shift+D mean "split what I'm looking at", so they resolve
      // against focus: a terminal pane splits itself, anything else splits the
      // diff (below). Decided here, ahead of the text-input guard, because
      // focus inside a terminal *is* focus in a textarea — xterm's. Cmd, never
      // Ctrl: Ctrl+D is EOF and belongs to the shell.
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === "d" || event.key === "D") &&
        splitFocusedTerminal(event.shiftKey ? "column" : "row")
      ) {
        event.preventDefault();
        return;
      }

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

      // Escape: dismiss overlay views in priority order (working-tree
      // rolling diff > split view).
      if (event.key === "Escape" && state.workingTreeMultiView !== null) {
        event.preventDefault();
        state.closeWorkingTreeMultiView();
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

        // Cmd+1 through Cmd+9: jump to visible sidebar item by position.
        // Walks the same tree the sidebar renders, honoring collapse state, so
        // the Nth keypress hits the Nth visible row.
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          event.preventDefault();
          const tree = buildSidebarTree(
            state.localActivity,
            state.globalReviews,
            state.globalReviewsByKey,
            state.sidebarPinned,
            state.sidebarDismissed,
            Date.now(),
            state.repoPath,
          );
          const items = rowsToItems(
            flattenSidebarTree(
              tree,
              state.collapsedRepos,
              state.expandedRepoRest,
              state.showInactiveRepos,
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

      // When the active comparison's branch is gone, its diff is hidden behind
      // the deleted-ref notice but the stale all-deleted hunks are still in the
      // store. Skip the single-key hunk shortcuts (j/k/a/r/s/H/L/z) so they
      // can't navigate or approve/reject hunks the user can't see. Review
      // switching (Cmd+1-9) and Escape above stay live so they can leave.
      if (
        getMissingRefs(state.reviewMissingRefs, state.repoPath, state.reviewRef)
          .length > 0
      ) {
        return;
      }

      switch (event.key) {
        case "j":
          // In any overlay view, switch to browse first so hunk navigation
          // lands in the single-file viewer rather than getting eaten.
          if (
            state.guideContentMode !== null ||
            state.workingTreeMultiView !== null
          ) {
            state.navigateToBrowse();
          }
          // Navigate to next hunk (handles file switching automatically)
          state.nextHunk();
          break;
        case "k":
          if (
            state.guideContentMode !== null ||
            state.workingTreeMultiView !== null
          ) {
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
