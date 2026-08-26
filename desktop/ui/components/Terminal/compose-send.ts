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

/**
 * Write a composed message and submit it.
 *
 * The text goes out exactly as typed — newlines included, in a single write —
 * and the trailing `\r` is the only byte this adds. A failed first write means
 * no Enter follows: half a message is recoverable, a half message that was then
 * submitted is not.
 */
export async function submitComposed(
  client: ApiClient,
  terminalId: string,
  text: string,
): Promise<void> {
  await client.terminalSubmit(terminalId, text);
}
