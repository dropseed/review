import { describe, it, expect } from "vitest";
import {
  type NewOutputEvent,
  type NewOutputState,
  initialNewOutput,
  newOutputVisible,
  reduceNewOutput,
} from "./new-output";

/** Fold a whole gesture in, the way the pane does one event at a time. */
function play(...events: NewOutputEvent[]): NewOutputState {
  return events.reduce(reduceNewOutput, initialNewOutput);
}

/** What the pane would be showing after those events. */
function shows(...events: NewOutputEvent[]): boolean {
  return newOutputVisible(play(...events));
}

const up: NewOutputEvent = { type: "viewport", atBottom: false };
const down: NewOutputEvent = { type: "viewport", atBottom: true };
const outputAway: NewOutputEvent = { type: "output", atBottom: false };
const outputHere: NewOutputEvent = { type: "output", atBottom: true };

describe("telling a reader they have missed something", () => {
  it("says nothing to a terminal at the bottom, however much it prints", () => {
    expect(shows(outputHere, outputHere, outputHere)).toBe(false);
  });

  it("says nothing about scrolling up on its own", () => {
    // Being away is a choice, not news. Only what lands while you are away is.
    expect(shows(up)).toBe(false);
  });

  it("appears when output lands while the reader is away", () => {
    expect(shows(up, outputAway)).toBe(true);
  });

  it("stays while the reader keeps reading, and while more arrives", () => {
    expect(shows(up, outputAway, up, outputAway, up)).toBe(true);
  });

  it("goes when the reader reaches the bottom by dragging", () => {
    expect(shows(up, outputAway, down)).toBe(false);
  });

  it("goes when output arrives while the reader is back at the bottom", () => {
    // The auto-scroll case: xterm follows the tail, so the bytes are read.
    expect(shows(up, outputAway, down, outputHere)).toBe(false);
  });

  it("does not linger once cleared", () => {
    expect(shows(up, outputAway, down, up)).toBe(false);
  });
});

describe("the alternate screen", () => {
  it("never shows it — a full-screen program has no bottom to be away from", () => {
    expect(shows({ type: "screen", alt: true }, up, outputAway)).toBe(false);
  });

  it("clears anything the normal screen had missed", () => {
    const state = play(up, outputAway, { type: "screen", alt: true });
    expect(newOutputVisible(state)).toBe(false);
    expect(state.missed).toBe(false);
  });

  it("comes back to the normal screen with nothing outstanding", () => {
    // The buffer restored underneath is a different screen than the one
    // anything was missed in, and xterm lands showing its bottom.
    const state = play(
      up,
      outputAway,
      { type: "screen", alt: true },
      { type: "screen", alt: false },
    );
    expect(state).toEqual({ missed: false, alt: false });
  });
});

describe("the state object", () => {
  it("is identical when nothing changed, so an idle terminal renders nothing", () => {
    // One of these fires per frame of output on a busy terminal; each new
    // object would be a render of the pane.
    const settled = play(up, outputAway);
    expect(reduceNewOutput(settled, outputAway)).toBe(settled);
    expect(reduceNewOutput(settled, up)).toBe(settled);
  });

  it("is a new object when something did", () => {
    const settled = play(up, outputAway);
    expect(reduceNewOutput(settled, down)).not.toBe(settled);
  });
});
