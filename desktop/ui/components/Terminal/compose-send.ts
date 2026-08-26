/**
 * Sending a composed message to a shell — the DOM-free half of the phone's
 * compose bar.
 *
 * This is `review terminal send --submit`, in the browser. Enter is written as
 * a *second* write, after a settle delay, rather than a `\r` appended to the
 * text: a TUI with an autocomplete popup open reads a newline arriving in the
 * same write as the text as accepting the highlighted entry, not as submitting
 * what was typed. Claude Code is exactly that TUI, and it is what this bar
 * exists to drive. Letting the popup settle first disambiguates the two.
 *
 * The delay itself is the client's only in the desktop app. In web mode it is
 * held by the server (`POST /api/terminal/submit`), because the client here is
 * a phone and iOS freezes a backgrounded PWA's timers — a send that reached the
 * gap and then went to the app switcher would leave the message typed and never
 * submitted. Which of the two happens is `ApiClient.terminalSubmit`'s business;
 * this is just the caller.
 */

import type { ApiClient } from "../../api/client";

/**
 * How long to wait between the text and the Enter that submits it.
 *
 * A copy of `review_core::terminal::SUBMIT_SETTLE_MS`, which is the same 500ms
 * the CLI defaults `--settle-ms` to: the same ambiguity is being resolved, and
 * a phone should not behave differently from a shell. There is no constant
 * sharing between the Rust and TypeScript halves of this app, so the two are
 * kept in step by hand — the doc comment on each names the other.
 */
export const SUBMIT_SETTLE_MS = 500;

/** What a terminal emulator puts in front of pasted text (DEC mode 2004). */
export const PASTE_BEGIN = "\x1b[200~";
/** What it puts after it. */
export const PASTE_END = "\x1b[201~";

/**
 * Wrap a submitted message in bracketed-paste markers when it spans lines.
 *
 * A newline arriving as ordinary input *is* a submit to anything with a line
 * editor, so a two-line message typed into the compose bar ran its first line
 * and left the rest stranded at a fresh prompt. Bracketed paste is the answer
 * every terminal emulator already gives: what lies between the markers is
 * content — newlines included — and the Enter that follows is the one thing
 * that submits it. A multi-line message is exactly what a paste is, and the
 * programs this bar exists to drive negotiate the mode (Claude Code, bash
 * 5.1+, zsh, fish).
 *
 * Two texts are left exactly as they came: **single-line** ones, which have no
 * newline to protect and would only hand the markers as input to a program
 * that never enabled the mode (a plain `sh`, `cat`); and anything **already
 * carrying an escape**, whose own `ESC [ 201 ~` would close the bracket early.
 *
 * A copy of `review_core::terminal::wrap_multiline_paste`, which is what the
 * web transport's `POST /api/terminal/submit` applies on the server — the two
 * are kept in step by hand, like {@link SUBMIT_SETTLE_MS} above.
 */
export function wrapMultilinePaste(text: string): string {
  if (!/[\n\r]/.test(text) || text.includes("\x1b")) return text;
  return `${PASTE_BEGIN}${text}${PASTE_END}`;
}

/**
 * Write a composed message and submit it.
 *
 * The text goes out exactly as typed — newlines included, in a single write —
 * and the trailing `\r` is the only byte this adds. A failed first write means
 * no Enter follows: half a message is recoverable, a half message that was then
 * submitted is not. Whether that single write is bracketed as a paste is
 * `ApiClient.terminalSubmit`'s business, so the two transports can each apply
 * it on the side of the wire that holds their settle.
 */
export async function submitComposed(
  client: ApiClient,
  terminalId: string,
  text: string,
): Promise<void> {
  await client.terminalSubmit(terminalId, text);
}
