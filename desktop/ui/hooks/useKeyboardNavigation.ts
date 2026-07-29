import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { isTextEntry } from "../commands/useCommandDispatch";
import { matchesEvent } from "../commands/shortcuts";

/**
 * Suppressed rather than handled: the in-file search bar owns ⌘F, and without
 * this the browser's own find bar opens over the app.
 */
const BLOCK_BROWSER_FIND = { code: "KeyF", mod: true } as const;

/**
 * The keyboard behaviour that is not a command.
 *
 * Everything with a plain "press this, do that" shape lives in the command
 * registry and is dispatched by `useCommandDispatch`. Two things do not fit
 * that shape and stay here: Escape, which dismisses overlays in priority order
 * and so depends on what is open rather than on which command is bound, and
 * ⌘F, which is suppressed rather than handled.
 */
export function useKeyboardNavigation() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't capture keys when typing in inputs
      if (isTextEntry(event.target)) return;

      if (matchesEvent(BLOCK_BROWSER_FIND, event)) {
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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
