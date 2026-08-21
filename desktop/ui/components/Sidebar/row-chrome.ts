/**
 * The keyboard half of a row's click.
 *
 * Every row in this sidebar is a `div role="button"` — `draggable` on a real
 * button is where webviews disagree about whether a drag starts at all — so
 * each one has to restore the Enter/Space activation the element it isn't
 * would have given it for free.
 */
export function activateOnKey(
  activate: () => void,
): (event: React.KeyboardEvent) => void {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
}

/** How far one level of nesting indents a card, in px. */
export const INDENT_STEP = 12;

/**
 * How deep the queue is willing to indent.
 *
 * Nesting itself is uncapped — a subtask's subtask is a real thing and the
 * backend will hold any depth. What is capped is the *drawing*: this column is
 * about 220px wide, and past a few levels every extra indent is paid for out
 * of the titles, which are the thing being read. Deeper cards keep the last
 * indent and are told apart by the rail and by the rows above them.
 */
export const MAX_DRAWN_DEPTH = 4;

/** The left inset a card (or an insertion line) at `depth` is drawn with. */
export function indentFor(depth: number): number {
  return Math.min(Math.max(depth, 0), MAX_DRAWN_DEPTH) * INDENT_STEP;
}
