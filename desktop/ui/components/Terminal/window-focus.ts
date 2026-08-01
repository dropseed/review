import { focusedTerminalId } from "./close";
import { setTerminalFocus } from "./registry";

/**
 * Forward OS window focus into the focused terminal.
 *
 * xterm reports focus (CSI ?1004, `\x1b[I` / `\x1b[O`) off its hidden
 * textarea's DOM focus and blur, and a webview losing OS focus fires neither —
 * the textarea keeps DOM focus the whole time the app sits in the background.
 * Nothing else called `blur()`, so a program running in the terminal believed
 * it was focused forever. That is not cosmetic: Codex's default
 * `notification_condition = "unfocused"` means it *only* notifies when it
 * thinks the terminal is unfocused, so it never sent one at all.
 *
 * Blurring on window blur and restoring on window focus makes the terminal's
 * belief match the OS, which is also what makes the `document.hasFocus()` gate
 * on our own notifications agree with the one inside the TUI.
 *
 * "Focused terminal" is the pane containing the focused element, so focus on a
 * pane's own chrome (a split button, the grip) counts. That costs nothing: the
 * blur of a terminal that wasn't focused is a no-op, and on return the chrome
 * still holds focus, which the guard below reads as "not ours to take back".
 */

/** The session we blurred, so only a focus we took is a focus we give back. */
let yielded: string | null = null;

function onWindowBlur(): void {
  const id = focusedTerminalId();
  if (!id) return; // focus was somewhere else in the app; not ours to move
  if (setTerminalFocus(id, false)) yielded = id;
}

function onWindowFocus(): void {
  const id = yielded;
  yielded = null;
  if (!id) return;
  // `blur()` drops focus to the body rather than moving it, so anything else
  // holding it means focus moved while we were away — a modal opened from the
  // menu, another pane activated. Coming back is not a reason to take it.
  const active = document.activeElement;
  if (active && active !== document.body) return;
  setTerminalFocus(id, true);
}

/** Install the window-level pair. Returns an unsubscribe. */
export function installTerminalWindowFocus(): () => void {
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("focus", onWindowFocus);
  return () => {
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("focus", onWindowFocus);
    yielded = null;
  };
}
