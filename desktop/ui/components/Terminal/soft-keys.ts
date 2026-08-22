/**
 * The keys a phone doesn't have.
 *
 * iOS software keyboards send characters and nothing else: no Escape, no Tab,
 * no Control, no arrows. That is most of what a terminal is driven with — Esc
 * to interrupt Claude Code, Tab to complete, arrows to walk history or a menu —
 * so a shell on a phone is readable but not usable without them. `SoftKeys`
 * draws them; this module is the part with no DOM in it.
 *
 * Control is the odd one out. It is not a key that sends something, it is a
 * modifier on the *next* key, and the next key comes from the system keyboard
 * we cannot reach. So it is armed here and consumed in the pane's own `onData`,
 * where every keystroke already passes: tap ⌃, type `c`, and what leaves is
 * `\x03`. One key only — a modifier that stayed on would be a mode, and a mode
 * you cannot see the state of on a phone is a trap.
 */

/** Whether the next character typed should be sent as a control code. */
let ctrlArmed = false;

const listeners = new Set<() => void>();

/** Subscribe to the armed state — the shape `useSyncExternalStore` wants. */
export function subscribeSoftKeys(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isCtrlArmed(): boolean {
  return ctrlArmed;
}

function setArmed(next: boolean): void {
  if (ctrlArmed === next) return;
  ctrlArmed = next;
  for (const listener of listeners) listener();
}

/** Arm (or disarm) Control for the next keystroke. */
export function toggleCtrl(): void {
  setArmed(!ctrlArmed);
}

/** Drop the modifier without using it — a pane losing its mount, a tab switch. */
export function clearCtrl(): void {
  setArmed(false);
}

/**
 * Apply whatever the key bar armed to a keystroke on its way to the PTY.
 *
 * Only a single character is transformed: a paste, or the multi-byte escape a
 * key already sends, is not what "Ctrl and then a key" means, and disarming on
 * it would eat the modifier the person is still waiting to use. Anything with
 * no control code (a digit, an accented letter) is sent as itself rather than
 * swallowed — and still disarms, because the tap was spent either way.
 */
export function applyArmedModifiers(data: string): string {
  if (!ctrlArmed) return data;
  if (data.length !== 1) return data;
  setArmed(false);
  return ctrlCode(data) ?? data;
}

/**
 * The control code a character carries, or null when it has none.
 *
 * The letters are the familiar `& 31`; the rest are the C0 codes a terminal
 * expects from the symbol row — ⌃[ is Escape, ⌃\ quits, ⌃] is telnet's escape,
 * and ⌃Space is the NUL that sets the mark in readline and emacs.
 */
export function ctrlCode(char: string): string | null {
  if (/^[a-zA-Z]$/.test(char)) {
    return String.fromCharCode(char.toUpperCase().charCodeAt(0) - 64);
  }
  const symbols: Record<string, number> = {
    "@": 0,
    " ": 0,
    "[": 27,
    "\\": 28,
    "]": 29,
    "^": 30,
    _: 31,
    "?": 127,
  };
  const code = symbols[char];
  return code === undefined ? null : String.fromCharCode(code);
}
