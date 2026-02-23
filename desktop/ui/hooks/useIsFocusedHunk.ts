import { useReviewStore } from "../stores";

/**
 * Returns whether a specific hunk is currently focused.
 *
 * Uses a derived-state selector (rerender-derived-state pattern) so the
 * component only re-renders when the boolean result actually changes —
 * i.e., when the hunk gains or loses focus — rather than on every
 * focusedHunkIndex update (which fires on each scroll event).
 */
export function useIsFocusedHunk(hunkId: string): boolean {
  return useReviewStore((s) => s.hunks[s.focusedHunkIndex]?.id === hunkId);
}
