/**
 * The text half of selecting on a phone: what the visible screen says, which
 * part of it a thumb landed on, and what leaves for the clipboard.
 *
 * All three are answered against strings rather than against a terminal, so
 * they can be checked without one — the pane supplies the buffer, this decides
 * what to do with it.
 */

/** The one thing this needs of an xterm buffer line. */
export interface SelectionLine {
  translateToString(trimRight?: boolean): string;
}

/** The one thing this needs of an xterm buffer. */
export interface SelectionBuffer {
  /** The first row of the visible screen, in buffer coordinates. */
  viewportY: number;
  getLine(y: number): SelectionLine | undefined;
}

/**
 * The visible screen, one string per row.
 *
 * Trailing whitespace goes (a row padded to 80 columns is 80 columns of
 * selectable nothing, and iOS's handles will happily drag out to the end of
 * it), but the row *count* stays: the overlay is drawn cell-for-cell on top of
 * the terminal, so row 12 has to be the twelfth box down whether or not
 * anything was printed on it. A row the buffer cannot supply is empty rather
 * than absent, for the same reason.
 */
export function snapshotRows(buffer: SelectionBuffer, rows: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(
      buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? "",
    );
  }
  return out;
}

/**
 * What counts as the edge of a "word" in terminal output.
 *
 * Deliberately not `\w`: the things worth grabbing out of a terminal with one
 * press are paths, URLs, branch names, hashes and `file.ts:120` — all of which
 * `\w` cuts into pieces. So a word is a run of anything that isn't whitespace
 * or one of the characters that surround such a run in real output: quotes,
 * brackets, and the punctuation a shell or a stack trace separates arguments
 * with. `:` `/` `.` `-` `?` `=` are deliberately *not* breaks: they are the
 * inside of a URL, not the edge of one.
 */
const WORD_BREAK = /[\s"'`()[\]{}<>,;|&]/;

/**
 * The word under a column, as offsets into the row — or null when the press
 * landed on whitespace or past the end of the text.
 *
 * Null is a real answer, not a failure: the overlay still opens, it simply
 * opens with nothing selected, and the person's second press gets iOS's own
 * selection over text that is now selectable. Guessing a neighbouring word
 * would be worse — the handles would appear somewhere they were not aimed.
 */
export function wordRangeAt(
  text: string,
  col: number,
): { start: number; end: number } | null {
  if (col < 0 || col >= text.length) return null;
  if (WORD_BREAK.test(text[col])) return null;
  let start = col;
  while (start > 0 && !WORD_BREAK.test(text[start - 1])) start -= 1;
  let end = col + 1;
  while (end < text.length && !WORD_BREAK.test(text[end])) end += 1;
  return { start, end };
}

/**
 * Clean up what the DOM serializes a multi-row selection as.
 *
 * The overlay is one block element per row, which is what makes the browser
 * put a newline between them at all — but the serialization also carries
 * whatever padding those boxes needed, and a selection dragged past the last
 * line of output picks up the blank rows below it. A terminal's own copy gives
 * neither, and text pasted back into a shell has to be the lines that were on
 * screen and nothing else.
 *
 * Interior blank lines stay: they are the gaps the program printed.
 */
export function normalizeCopyText(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    // A no-break space is how a browser keeps an empty box from collapsing;
    // pasting one into a shell is not what anybody copied.
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[ \t]+$/, ""));
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first] === "") first += 1;
  while (last > first && lines[last - 1] === "") last -= 1;
  return lines.slice(first, last).join("\n");
}
