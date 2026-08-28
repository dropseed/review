/**
 * The last rung of ⌘W: closing the window itself.
 *
 * Every rung above it is small and reversible — a terminal pane, a split, a
 * file — and this one takes the whole window with it, which is more than a
 * keystroke aimed at a pane should be able to do by itself. So it asks first,
 * the way a browser asks before closing a window full of tabs.
 */

import { getPlatformServices } from "../platform";
import { useReviewStore } from "../stores";
import { flushPendingCloses } from "../components/Terminal/close";

/** Terminals still holding a live PTY — what the window is standing in front of. */
function liveTerminalCount(): number {
  const { terminalSessions, terminalExited } = useReviewStore.getState();
  return Object.keys(terminalSessions).filter((id) => !(id in terminalExited))
    .length;
}

/**
 * The question, naming what survives the answer.
 *
 * The terminals belong to `review-daemon`, not to this window, so closing it
 * kills nothing — and someone who believes otherwise answers the wrong way.
 */
export function closeWindowPrompt(running: number): string {
  if (running === 0) return "Close the Review window?";
  const [noun, verb, pronoun] =
    running === 1 ? ["terminal", "keeps", "it"] : ["terminals", "keep", "them"];
  return `Close the Review window?\n\n${running} ${noun} ${verb} running in the background — reopening Review brings ${pronoun} back.`;
}

/**
 * One prompt at a time. ⌘W is a key people lean on, and the dialog is async:
 * without this, three impatient presses stack three dialogs and the two behind
 * the answered one still have to be dismissed.
 */
let asking = false;

/**
 * Ask, then close. Answers whether the window actually closed, so a caller can
 * tell "declined" from "done".
 */
export async function closeWindowWithConfirmation(): Promise<boolean> {
  if (asking) return false;
  asking = true;
  try {
    const platform = getPlatformServices();
    // A dialog that fails to open answers false and says so itself — see
    // DialogService.confirm. Not closing is the right default either way.
    const ok = await platform.dialogs.confirm(
      closeWindowPrompt(liveTerminalCount()),
      "Close window",
    );
    if (!ok) return false;
    // A close still holding its shell for undo has to go through before the
    // window does — after that there is nothing left to undo it from, and the
    // shell would run on unlisted.
    await flushPendingCloses();
    await platform.window.close();
    return true;
  } finally {
    asking = false;
  }
}
