/**
 * The sidebar header's `+` reaching the "Working on" section's own input.
 *
 * A signal rather than a store field, built the way `work-drag` is: what it
 * asks for is a DOM focus in a component the header does not render, and
 * nothing about it outlives the gesture. A boolean in the store would stay
 * "an add was requested" long after the input closed, and would have to be
 * cleared by whoever consumed it — a counter that only ever goes up needs no
 * such handshake.
 */

import { useSyncExternalStore } from "react";

let requests = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ask the "Working on" section to open its add row and take the keyboard. */
export function requestAddWorkItem(): void {
  requests++;
  for (const listener of listeners) listener();
}

/** Bumped on every request, so a repeat press re-focuses an open input. */
export function useAddWorkItemRequests(): number {
  return useSyncExternalStore(
    subscribe,
    () => requests,
    () => requests,
  );
}
