import { describe, it, expect } from "vitest";
import {
  COMMIT_FRACTION,
  EDGE_ZONE_PX,
  codePushed,
  dragProgress,
  popCommits,
  startsAtEdge,
} from "./push-nav";

describe("which screen the compact stack is showing", () => {
  it("pushes the code half when it has the stage", () => {
    expect(codePushed("code", true)).toBe(true);
  });

  it("is the terminal for both of the other two, since split resolves to it", () => {
    expect(codePushed("split", true)).toBe(false);
    expect(codePushed("terminal", true)).toBe(false);
  });

  /**
   * With no terminal half the code half is the only screen there is — it is not
   * pushed over anything, so it must not wear a back affordance pointing at a
   * screen that doesn't exist.
   */
  it("is never a push when there is no terminal underneath", () => {
    expect(codePushed("code", false)).toBe(false);
    expect(codePushed("split", false)).toBe(false);
  });
});

describe("the edge zone", () => {
  it("takes a touch inside the strip and declines one past it", () => {
    expect(startsAtEdge(0)).toBe(true);
    expect(startsAtEdge(EDGE_ZONE_PX)).toBe(true);
    expect(startsAtEdge(EDGE_ZONE_PX + 1)).toBe(false);
  });

  /** The screen need not start at x=0 — it is measured from its own left edge. */
  it("measures from the element, not the viewport", () => {
    expect(startsAtEdge(105, 100)).toBe(true);
    expect(startsAtEdge(95, 100)).toBe(false);
  });
});

describe("following the finger", () => {
  it("reports the drag as a fraction of the screen", () => {
    expect(dragProgress(195, 390)).toBeCloseTo(0.5);
  });

  it("never drags the screen left of home or past its own width", () => {
    expect(dragProgress(-40, 390)).toBe(0);
    expect(dragProgress(900, 390)).toBe(1);
  });

  /** An unmeasured screen is not a fully-popped one. */
  it("reads an unmeasured screen as home", () => {
    expect(dragProgress(50, 0)).toBe(0);
  });
});

describe("whether letting go pops", () => {
  const width = 390;
  const past = width * COMMIT_FRACTION + 1;
  const short = width * COMMIT_FRACTION - 1;

  it("commits past a third of the width, however slowly it got there", () => {
    expect(popCommits({ dx: past, dt: 4000, width })).toBe(true);
  });

  it("springs back short of it at a walking pace", () => {
    expect(popCommits({ dx: short, dt: 1200, width })).toBe(false);
  });

  /** A flick is the whole reason a short swipe from the edge works at all. */
  it("commits a short but fast throw", () => {
    expect(popCommits({ dx: 60, dt: 100, width })).toBe(true);
  });

  it("treats a wobble as a tap, whatever velocity it computes to", () => {
    expect(popCommits({ dx: 3, dt: 1, width })).toBe(false);
  });

  /** Two events in the same millisecond are not infinitely fast. */
  it("declines to divide by a zero-length drag", () => {
    expect(popCommits({ dx: short, dt: 0, width })).toBe(false);
  });

  it("never pops on a drag the wrong way", () => {
    expect(popCommits({ dx: -200, dt: 100, width })).toBe(false);
  });
});
