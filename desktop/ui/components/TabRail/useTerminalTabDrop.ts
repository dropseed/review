import { useState, type DragEvent } from "react";
import { useReviewStore } from "../../stores";
import { pointerLeft } from "../Terminal/pane-drag";
import { makeReviewKey } from "../../utils/review-key";

/**
 * The drag payload for a terminal tab. A type of its own rather than
 * `text/plain`, because a row has to decide during `dragover` — before the data
 * can be read — whether it is a drop target at all, and `types` is the only
 * thing readable then.
 */
export const TERMINAL_TAB_MIME = "application/x-review-terminal-tab";

/** The app's one "you can drop here" treatment, for any drop target that lights
 *  up as a whole rather than showing where within itself the thing will land. */
export const DROP_RING = "ring-1 ring-inset ring-focus-ring bg-fg/[0.06]";

interface TerminalTabDrop {
  /** Ring class while a terminal tab is over this row; empty otherwise. */
  dropClass: string;
  /** Spread onto the row element. */
  dropProps: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * Make a sidebar row a drop target for terminal tabs — the gesture for "this
 * shell belongs to that branch".
 *
 * The shell is not moved: it keeps running in the directory it started in, and
 * the row it now answers to is a stored fact about it. That is the honest
 * version of this — a `cd` would lie to any process already running in the
 * pane, and re-deriving from the directory is what made terminals move on their
 * own in the first place.
 *
 * A row with no ref declines the drop. That is the repo row of a repo with
 * nothing checked out, whose key would be the `repoPath:""` placeholder — a
 * bucket no view reads, so a tab homed there would persist a home that renders
 * nowhere.
 */
export function useTerminalTabDrop(
  repoPath: string,
  reviewRef: string,
): TerminalTabDrop {
  const setTabHome = useReviewStore((s) => s.setTabHome);
  const [isOver, setIsOver] = useState(false);
  const droppable = reviewRef !== "";

  return {
    dropClass: isOver ? DROP_RING : "",
    dropProps: {
      onDragOver: (e) => {
        if (!droppable) return;
        if (!e.dataTransfer.types.includes(TERMINAL_TAB_MIME)) return;
        // Claimed only for terminal tabs; a file drag falls through to whatever
        // else on the page wants it.
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
      },
      onDragLeave: (e) => {
        if (pointerLeft(e)) setIsOver(false);
      },
      onDrop: (e) => {
        setIsOver(false);
        if (!droppable) return;
        const tabId = e.dataTransfer.getData(TERMINAL_TAB_MIME);
        if (!tabId) return;
        e.preventDefault();
        e.stopPropagation();
        setTabHome(tabId, makeReviewKey(repoPath, reviewRef));
      },
    },
  };
}
