/**
 * Keyboard shortcut description, shared by everything that needs to know about
 * a binding: the palette renders it, the window keydown handler dispatches on
 * it, and the native menu is built from it.
 */
export interface Shortcut {
  /**
   * `KeyboardEvent.code` — the physical key, e.g. "KeyP", "Digit1",
   * "Backslash".
   *
   * Deliberately not `key`: on macOS, Option+C reports `key === "ç"`, so any
   * binding involving Alt that tests `key` silently never fires.
   */
  code: string;
  /** Command on macOS, Control elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** True on Apple platforms, where `mod` means Command rather than Control. */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** The `mod` key as users see it. */
export const MOD_SYMBOL = IS_MAC ? "⌘" : "Ctrl";

/** Human-readable key names for codes that do not speak for themselves. */
const CODE_LABELS: Record<string, string> = {
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Enter",
  Escape: "Esc",
  Space: "Space",
};

function keyLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** Render as discrete `<kbd>` tokens, e.g. `["⌘", "⇧", "F"]`. */
export function formatShortcut(shortcut: Shortcut): string[] {
  const parts: string[] = [];
  if (shortcut.mod) parts.push(MOD_SYMBOL);
  if (shortcut.alt) parts.push(IS_MAC ? "⌥" : "Alt");
  if (shortcut.shift) parts.push(IS_MAC ? "⇧" : "Shift");
  parts.push(keyLabel(shortcut.code));
  return parts;
}

/**
 * Render as a Tauri menu accelerator, e.g. `"CmdOrCtrl+Shift+F"`.
 *
 * This is what keeps the native menu from being a second, hand-maintained copy
 * of the keymap that drifts from the one the app actually dispatches on.
 */
export function toAccelerator(shortcut: Shortcut): string {
  const parts: string[] = [];
  if (shortcut.mod) parts.push("CmdOrCtrl");
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  parts.push(keyLabel(shortcut.code));
  return parts.join("+");
}

/** Whether a keyboard event is this shortcut. */
export function matchesEvent(
  shortcut: Shortcut,
  event: KeyboardEvent | React.KeyboardEvent,
): boolean {
  if (event.code !== shortcut.code) return false;

  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  // The non-platform modifier must be absent, or Ctrl+P on a Mac would fire a
  // Cmd+P binding.
  const otherMod = IS_MAC ? event.ctrlKey : event.metaKey;

  if (mod !== !!shortcut.mod) return false;
  if (otherMod) return false;
  if (event.shiftKey !== !!shortcut.shift) return false;
  if (event.altKey !== !!shortcut.alt) return false;

  return true;
}
