import { useReviewStore } from "../stores";

/**
 * Returns whether a specific hunk is currently focused.
 *
 * Uses a derived-state selector so the component only re-renders when the
 * boolean result actually changes — i.e., when the hunk gains or loses
 * focus — rather than on every focusedHunkId update.
 */
export function useIsFocusedHunk(hunkId: string): boolean {
  return useReviewStore((s) => s.focusedHunkId === hunkId);
}
