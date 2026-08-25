/**
 * Finding the URL under a position in a line of text.
 *
 * Two surfaces ask this — a ⌘-click in the diff (`getUrlAtClick`, which
 * reconstructs the line from Shiki's spans) and a tap in a terminal
 * (`Terminal/registry`'s `openLinkAt`, which joins the buffer's wrapped rows) —
 * and they must agree: the same URL read in both places has to open the same
 * page. The rules that make them disagree are all in the trailing punctuation,
 * so those rules live here, once.
 */

/**
 * Stops short of `]},;` so a URL inside brackets or a list ends where the
 * prose resumes. `)` is deliberately *not* excluded here — it can belong to
 * either the URL (a Wikipedia-style `Foo_(bar)`) or the surrounding prose (a
 * markdown link's `(url)`, a parenthetical aside), and only `cleanUrlTrailing`
 * below can tell those apart by checking whether the parens balance.
 * Excluding it here would cut the match off at the first `)` either way,
 * before that check ever ran.
 */
const URL_RE = /https?:\/\/[^\s"'`<>\]},;]+/g;

/** Strip trailing punctuation likely from sentence-level context, not the URL itself. */
export function cleanUrlTrailing(url: string): string {
  let cleaned = url.replace(/[.,]+$/, "");

  // Strip trailing ')' only if unbalanced (preserves Wikipedia-style URLs).
  let open = 0;
  let close = 0;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "(") open++;
    else if (cleaned[i] === ")") close++;
  }
  while (cleaned.endsWith(")") && close > open) {
    cleaned = cleaned.slice(0, -1);
    close--;
  }

  return cleaned;
}

/**
 * The URL covering `[charStart, charEnd)` in `lineText`, or null.
 *
 * A tap is a single character, so both ends are the same offset; a click on a
 * syntax-highlighting span is a range.
 */
export function findUrlAtOffset(
  lineText: string,
  charStart: number,
  charEnd: number = charStart + 1,
): string | null {
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(lineText)) !== null) {
    const urlStart = match.index;
    const urlEnd = urlStart + match[0].length;
    if (charStart < urlEnd && charEnd > urlStart) {
      return cleanUrlTrailing(match[0]);
    }
  }
  return null;
}
