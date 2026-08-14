/**
 * The palette's modes, and the prefixes that switch between them.
 *
 * Four surfaces used to be four dialogs behind four shortcuts, each a dead end:
 * typing a filename into ⌘K found nothing, and realising mid-search that you
 * wanted a symbol meant closing and reopening. They are one dialog now, and the
 * shortcuts seed a mode rather than summoning a component.
 *
 * Prefixes follow VS Code where it defines them (`>` commands, `@` symbols,
 * nothing for files) so the muscle memory transfers. `#` is this app's own: VS
 * Code spends it on workspace symbols, which there is no equivalent of here,
 * and content search is the surface left needing one.
 *
 * Deliberately dependency-free — the store imports this to type its opening
 * mode, and the store is what everything else imports.
 */

export type PaletteMode = "go" | "files" | "commands" | "symbols" | "content";

interface ModeInfo {
  /** Character that switches to this mode, or null for the unprefixed root. */
  prefix: string | null;
  /** Shown in the chip beside the input. */
  label: string;
}

export const PALETTE_MODES: Record<PaletteMode, ModeInfo> = {
  // Where ⌘K lands. Everything the app can navigate to is one list, and the
  // other modes are what you reach from it by typing a prefix.
  go: { prefix: null, label: "Go" },
  files: { prefix: "/", label: "Files" },
  commands: { prefix: ">", label: "Commands" },
  symbols: { prefix: "@", label: "Symbols" },
  content: { prefix: "#", label: "In Files" },
};

/** The mode a prefix character selects, or null if it is not a prefix. */
export function modeForPrefix(char: string): PaletteMode | null {
  for (const [mode, info] of Object.entries(PALETTE_MODES)) {
    if (info.prefix === char) return mode as PaletteMode;
  }
  return null;
}

/**
 * Read a mode switch out of an input change, or null to take the text as typed.
 *
 * Only fires when the input goes from empty to exactly one prefix character,
 * and only when that names a mode other than the current one. Both halves are
 * load-bearing: without the first, `#include` typed into content search would
 * lose its `#` to a mode switch on the very first keystroke; without the
 * second, the `#` would be eaten by a switch to the mode already showing.
 *
 * The cost is that a search which genuinely starts with `@` or `#` cannot be
 * typed from an empty box — the same trade VS Code makes. Backspace on an empty
 * query steps back through the modes visited, which is the way out.
 */
export function readModeSwitch(
  previous: string,
  next: string,
  current: PaletteMode,
): PaletteMode | null {
  if (previous !== "" || next.length !== 1) return null;
  const mode = modeForPrefix(next);
  return mode !== null && mode !== current ? mode : null;
}
