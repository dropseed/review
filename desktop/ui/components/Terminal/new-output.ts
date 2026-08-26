/**
 * Whether a reader who has scrolled up has missed something.
 *
 * A terminal that is being read is a terminal nobody is watching the bottom
 * of: scroll up to find the error and the agent's next hundred lines land off
 * screen with nothing to say so. Every chat app answers this with a jump-to-
 * bottom pill, and a terminal is the surface where it matters most, because
 * the thing that arrived is why you opened the app.
 *
 * Three facts decide it and the DOM answers all three, so this module is the
 * rules and nothing else — which is what lets them be read in one place:
 *
 * - **At the bottom**, `viewportY` vs `baseY`. Being at the bottom is the
 *   normal state and the only one that needs no affordance.
 * - **Output arrived**, `onWriteParsed`. Bytes landing while the reader is at
 *   the bottom are simply the terminal working; only bytes landing while they
 *   are *away* are news.
 * - **The alternate screen**, `onBufferChange`. A full-screen program has no
 *   scrollback to be away from, its repaints are not "new output", and a drag
 *   there sends cursor keys rather than scrolling — so the pill never appears
 *   over one.
 *
 * Coming back to the bottom by any means clears it: the tap, a drag, a wheel,
 * or output arriving while already there. There is no dismiss — arriving is
 * the acknowledgement, the same rule the workspace cards' attention signals
 * follow.
 */

export interface NewOutputState {
  /** Whether output has arrived since it stopped showing the bottom. */
  missed: boolean;
  /** Whether the terminal is on its alternate screen. */
  alt: boolean;
}

export type NewOutputEvent =
  /** The viewport moved (a drag, a wheel, the pill's own jump). */
  | { type: "viewport"; atBottom: boolean }
  /** Bytes were parsed into the buffer, leaving the viewport where it says. */
  | { type: "output"; atBottom: boolean }
  /** The terminal switched buffers. */
  | { type: "screen"; alt: boolean };

/** A terminal nobody has scrolled yet: at the bottom, with nothing missed. */
export const initialNewOutput: NewOutputState = {
  missed: false,
  alt: false,
};

/**
 * Fold one event in, returning the *same* object when nothing changed — a
 * terminal at the bottom fires one of these per frame of output, and each one
 * would otherwise be a React render of the pane.
 *
 * Where the viewport is sitting is not kept: it is only ever asked about at the
 * moment an event carries it, and the two answers that matter are both already
 * folded into `missed` — output landing away from the bottom sets it, arriving
 * at the bottom by any means clears it.
 */
export function reduceNewOutput(
  state: NewOutputState,
  event: NewOutputEvent,
): NewOutputState {
  const { missed, alt } = state;
  switch (event.type) {
    case "viewport":
      // Only arriving clears it. Scrolling *further* up is still away, and
      // leaving the bottom is not by itself something to report.
      return event.atBottom && missed ? { missed: false, alt } : state;
    case "output": {
      // The alternate screen's repaints are not news, and its buffer has no
      // bottom to be away from.
      const now = !event.atBottom && !alt;
      return now === missed ? state : { missed: now, alt };
    }
    case "screen":
      // Either direction is a different buffer than the one anything was
      // missed in, and both land showing their own bottom.
      return !missed && alt === event.alt
        ? state
        : { missed: false, alt: event.alt };
  }
}

/** Whether the pane should be offering the jump. */
export function newOutputVisible(state: NewOutputState): boolean {
  return state.missed;
}
