/**
 * Dragging a pane to rearrange a tab's splits, the way Ghostty does it: pick a
 * pane up by its grip, hover another pane, and the half you're pointing at
 * lights up as the side it will land on.
 *
 * The geometry is here, pure, so the edge a pointer resolves to can be tested
 * without a DOM; the tree move it feeds is `movePane` in pane-tree.
 */

import { useSyncExternalStore } from "react";
import type { DropEdge } from "./pane-tree";

/**
 * The drag payload for a terminal pane. A type of its own rather than
 * `text/plain`, because a pane has to decide during `dragover` — before the data
 * can be read — whether this is a drag it should take, and `types` is the only
 * thing readable then.
 */
export const TERMINAL_PANE_MIME = "application/x-review-terminal-pane";

/** The part of a DOMRect the hit test needs. */
export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Which edge of `rect` the point is nearest, as a fraction of that axis rather
 * than in pixels — the panel is often tall and narrow, and an absolute
 * comparison would make the top and bottom edges unreachable there.
 *
 * The result is the four triangles cut by the rect's diagonals: point at the
 * left third of a pane and you get "left" wherever you are vertically, which is
 * the mapping the half-pane highlight then draws.
 */
export function edgeForPoint(rect: PaneRect, x: number, y: number): DropEdge {
  const nx = rect.width > 0 ? (x - rect.left) / rect.width : 0.5;
  const ny = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  const candidates: [DropEdge, number][] = [
    ["left", nx],
    ["right", 1 - nx],
    ["top", ny],
    ["bottom", 1 - ny],
  ];
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate[1] < best[1]) best = candidate;
  }
  return best[0];
}

/**
 * The pane currently being dragged, if any.
 *
 * Module state rather than store state: nothing here is worth persisting, and
 * this is read on every `dragover` to decide whether a pane is hovering itself
 * — a question `dataTransfer` refuses to answer at that moment, which is the
 * other half of why it's kept here.
 *
 * It changes twice per drag (start and end), so the components that need to
 * *react* to it — the tab strip, which grows drop targets while a pane is in
 * flight — subscribe rather than poll.
 */
let dragged: string | null = null;
const listeners = new Set<() => void>();

export function setDraggedPane(id: string | null): void {
  if (dragged === id) return;
  dragged = id;
  for (const listener of listeners) listener();
}

export function draggedPane(): string | null {
  return dragged;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pane being dragged right now, re-rendering the caller when it changes. */
export function usePaneDragActive(): string | null {
  return useSyncExternalStore(subscribe, draggedPane, () => null);
}
