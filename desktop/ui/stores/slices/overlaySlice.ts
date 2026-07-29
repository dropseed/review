import type { SliceCreator } from "../types";
import type { PaletteMode } from "../../components/palette/modes";

/**
 * The transient surfaces that sit above the review: the palette and the modals.
 *
 * The four search dialogs used to be four ids here. They are one `palette` with
 * a mode now — see `components/palette/modes.ts`.
 */
export type OverlayId = "palette" | "classifications" | "settings" | "debug";

export interface OverlaySlice {
  /** The one overlay currently on screen, if any. */
  activeOverlay: OverlayId | null;
  /** Which mode the palette opens in. Read only as it opens. */
  paletteMode: PaletteMode;
  openOverlay: (id: OverlayId) => void;
  /** Raise the palette in a given mode — what each search shortcut does. */
  openPalette: (mode: PaletteMode) => void;
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
  paletteMode: "commands",
  openOverlay: (id) => set({ activeOverlay: id }),
  openPalette: (mode) => set({ activeOverlay: "palette", paletteMode: mode }),
  closeOverlay: (id) => {
    if (id && get().activeOverlay !== id) return;
    set({ activeOverlay: null });
  },
});
