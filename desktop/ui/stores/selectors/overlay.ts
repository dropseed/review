import { useReviewStore } from "../index";
import type { OverlayId } from "../slices/overlaySlice";

/** Whether `id` is the overlay currently on screen. */
export function useOverlay(id: OverlayId): boolean {
  return useReviewStore((s) => s.activeOverlay === id);
}

/** Close `id`, if it is the overlay currently on screen. */
export function useCloseOverlay(id: OverlayId): () => void {
  const closeOverlay = useReviewStore((s) => s.closeOverlay);
  return () => closeOverlay(id);
}

/**
 * Re-render on any store write.
 *
 * A deliberate blunt instrument, for the one case that needs it: the command
 * palette evaluates opaque predicates over arbitrary state, so no narrower
 * subscription can know when a command's availability has changed. Only call
 * this from a component that is mounted while it is on screen.
 */
export function useStoreRevision(): void {
  useReviewStore((s) => s);
}
