import type { DragEvent } from "react";
import { setDraggedWorkRef, startWorkRefDrag } from "./work-drag";

/**
 * Make a branch-bearing sidebar row draggable into "Working on".
 *
 * The row is not moved or changed by the drag — the tree still shows what
 * exists — so this is a copy gesture in every sense except the cursor, which
 * says "move" because that is what dropping it *does* to the list above.
 *
 * Every row that can carry one is draggable, and every drag has a menu
 * equivalent (`refRowActions` in `work-actions`): a list you can only build by
 * dragging is a list you can't build from the keyboard.
 */
export function useWorkRefDrag(
  repoPath: string,
  ref: string,
): {
  draggable: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
} {
  const droppable = ref !== "";
  return {
    draggable: droppable,
    onDragStart: (event) => {
      if (!droppable) return;
      startWorkRefDrag(event, { ref: { repoPath, ref }, fromItemId: null });
    },
    onDragEnd: () => setDraggedWorkRef(null),
  };
}
