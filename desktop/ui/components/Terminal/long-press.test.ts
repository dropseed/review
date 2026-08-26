import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, createLongPress } from "./long-press";

/**
 * The press, and the four things that are not it.
 *
 * All of this is about *not* firing: a terminal on a phone already answers a
 * tap, a scroll, a swipe and a pinch, and every one of them starts with a
 * finger landing. What the timer is for is telling them apart afterwards.
 */

const SLOP = 6;

function press(onFire = vi.fn()) {
  return { onFire, press: createLongPress({ slopPx: SLOP, onFire }) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a long press", () => {
  it("fires where the finger landed, once it has rested long enough", () => {
    const { press: p, onFire } = press();
    p.start(100, 200);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onFire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledWith(100, 200);
    expect(p.pending).toBe(false);
  });

  it("survives the wobble any real thumb makes", () => {
    const { press: p, onFire } = press();
    p.start(100, 200);
    p.move(103, 202);
    vi.advanceTimersByTime(LONG_PRESS_MS);

    // Still the point it landed on, not the one it drifted to: within the slop
    // the two are the same press, and the landing point is what was aimed.
    expect(onFire).toHaveBeenCalledWith(100, 200);
  });

  it("is cancelled by the movement that commits a drag", () => {
    const { press: p, onFire } = press();
    p.start(100, 200);
    p.move(100, 200 + SLOP);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onFire).not.toHaveBeenCalled();
    expect(p.pending).toBe(false);
  });

  it("stays cancelled when the finger comes back", () => {
    const { press: p, onFire } = press();
    p.start(100, 200);
    p.move(100, 400);
    p.move(100, 200);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onFire).not.toHaveBeenCalled();
  });

  it("is cancelled by a lift, a second finger, or the pane going away", () => {
    const { press: p, onFire } = press();
    p.start(100, 200);
    p.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onFire).not.toHaveBeenCalled();
  });

  it("restarts the clock for a new finger rather than crediting the old one", () => {
    const { press: p, onFire } = press();
    p.start(100, 200);
    vi.advanceTimersByTime(LONG_PRESS_MS - 10);
    p.start(300, 400);
    vi.advanceTimersByTime(20);
    expect(onFire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith(300, 400);
  });

  it("ignores movement when nothing is pending", () => {
    const { press: p, onFire } = press();
    p.move(500, 500);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onFire).not.toHaveBeenCalled();
  });
});
