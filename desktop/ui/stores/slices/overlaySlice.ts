import type { SliceCreator } from "../types";

/**
 * The transient surfaces that sit above the review: search dialogs, the
 * command palette, and the modals.
 */
export type OverlayId =
  | "commandPalette"
  | "fileFinder"
  | "symbolSearch"
  | "contentSearch"
  | "classifications"
  | "settings"
  | "debug";

export interface OverlaySlice {
  /** The one overlay currently on screen, if any. */
  activeOverlay: OverlayId | null;
  openOverlay: (id: OverlayId) => void;
  /**
   * Close `id`, or whatever is open if no id is given.
   *
   * Passing the id matters for dialogs that close asynchronously: without it,
   * a dismissal arriving after the user has already opened something else
   * would shut the newer overlay instead.
   */
  closeOverlay: (id?: OverlayId) => void;
}

/**
 * One active overlay rather than a boolean per surface.
 *
 * Independent flags let two overlays be open at once — ⌘K over the file finder
 * set both — and each new surface cost a pair of slice members, a `CommandUi`
 * method, and a wiring site. Mutual exclusion is the actual rule, so it is
 * worth making structural.
 */
export const createOverlaySlice: SliceCreator<OverlaySlice> = (set, get) => ({
  activeOverlay: null,
  openOverlay: (id) => set({ activeOverlay: id }),
  closeOverlay: (id) => {
    if (id && get().activeOverlay !== id) return;
    set({ activeOverlay: null });
  },
});
