import { useEffect } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { flattenSidebarTree, type SidebarRow } from "../utils/sidebar-tree";
import { getSidebarTree } from "../stores/selectors/sidebar";
import { isTextEntry } from "../commands/useCommandDispatch";

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
 * Keyboard behaviour that is not a command.
 *
 * Everything with a plain "press this, do that" shape now lives in the command
 * registry and is dispatched by `useCommandDispatch`. What is left are the
 * three bindings that genuinely are not single commands:
 *
 * - **Escape** dismisses overlays in priority order, so what it does depends
 *   on what is open rather than on which command is bound.
 * - **⌘1–9** is one action taking a positional argument, not nine commands.
 * - **⌘F** is suppressed rather than handled, to keep the browser's own find
 *   bar from opening over the app.
 */
export function useKeyboardNavigation() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't capture keys when typing in inputs
      if (isTextEntry(event.target)) return;

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

      // Cmd+1 through Cmd+9: jump to visible sidebar item by position.
      // Walks the same tree the sidebar renders, honoring collapse state, so
      // the Nth keypress hits the Nth visible row.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          event.preventDefault();
          const tree = getSidebarTree(state, Date.now(), state.repoPath);
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
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
