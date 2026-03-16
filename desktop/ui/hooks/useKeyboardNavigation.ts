import { useEffect } from "react";
import { useReviewStore } from "../stores";
import {
  makeComparison,
  type Comparison,
  type RepoLocalActivity,
  type GlobalReviewSummary,
} from "../types";
import type { ActiveReviewKey } from "../stores/slices/tabRailSlice";
import { makeReviewKey } from "../stores/slices/groupingSlice";
import { LOCAL_REPO_DEFAULT_COLLAPSED } from "../stores/slices/localActivitySlice";

interface SidebarItem {
  key: string;
  reviewKey: ActiveReviewKey;
  comparison: Comparison;
}

/** Build a flat list of all sidebar items (local branches first, then reviews). */
function buildSidebarItemList(state: {
  localActivity: RepoLocalActivity[];
  globalReviews: GlobalReviewSummary[];
  localRepoCollapsed: Record<string, boolean>;
  localViewMode: "changes" | "all";
}): SidebarItem[] {
  const items: SidebarItem[] = [];

  // Local branches first (filter by view mode and skip collapsed repos in "all" mode)
  for (const repo of state.localActivity) {
    if (
      state.localViewMode === "all" &&
      (state.localRepoCollapsed[repo.repoPath] ?? LOCAL_REPO_DEFAULT_COLLAPSED)
    )
      continue;
    for (const branch of repo.branches) {
      if (state.localViewMode === "changes" && !branch.hasWorkingTreeChanges)
        continue;
      const comparison = makeComparison(repo.defaultBranch, branch.name);
      items.push({
        key: makeReviewKey(repo.repoPath, comparison.key),
        reviewKey: {
          repoPath: repo.repoPath,
          comparisonKey: comparison.key,
        },
        comparison,
      });
    }
  }

  // Then reviews
  for (const review of state.globalReviews) {
    items.push({
      key: makeReviewKey(review.repoPath, review.comparison.key),
      reviewKey: {
        repoPath: review.repoPath,
        comparisonKey: review.comparison.key,
      },
      comparison: review.comparison,
    });
  }

  return items;
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
 * Cmd+Shift+F, Cmd+Shift+N, Cmd+B, Cmd+Shift+D, Cmd+,,
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

      // Cmd/Ctrl+0, Cmd/Ctrl+=, Cmd/Ctrl+- are handled via Tauri menu accelerators + useMenuEvents

      // Cmd+ArrowUp / Cmd+ArrowDown: cycle through sidebar items
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const items = buildSidebarItemList(state);
          if (items.length === 0) return;

          const currentKey = state.activeReviewKey
            ? makeReviewKey(
                state.activeReviewKey.repoPath,
                state.activeReviewKey.comparisonKey,
              )
            : null;
          const currentIdx = currentKey
            ? items.findIndex((item) => item.key === currentKey)
            : -1;

          let nextIdx: number;
          if (event.key === "ArrowDown") {
            nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
          } else {
            nextIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
          }

          const next = items[nextIdx];
          if (next) activateSidebarItem(state, next);
          return;
        }

        // Cmd+1 through Cmd+9: jump to sidebar item by position
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          event.preventDefault();
          const items = buildSidebarItemList(state);
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
            ? state.hunks.find((h) => h.id === state.focusedHunkId)
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
