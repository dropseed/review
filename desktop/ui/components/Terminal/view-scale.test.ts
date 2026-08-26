import { describe, it, expect } from "vitest";
import {
  SCALE_CHIP_THRESHOLD,
  formatScale,
  scaleChipVisible,
} from "./view-scale";

describe("when the strip reports a scaled terminal", () => {
  it("says nothing about a drawing at (or near) its true size", () => {
    expect(scaleChipVisible(1)).toBe(false);
    expect(scaleChipVisible(SCALE_CHIP_THRESHOLD)).toBe(false);
    expect(scaleChipVisible(0.99)).toBe(false);
  });

  it("appears once the shrink is one a person can see", () => {
    expect(scaleChipVisible(0.94)).toBe(true);
    expect(scaleChipVisible(0.6)).toBe(true);
  });

  it("treats an unmeasured pane as not scaled rather than as scaled to nothing", () => {
    // A pane with no size yet reports 0, and a chip claiming "0%" while the
    // first layout is still pending is a control appearing out of nowhere.
    expect(scaleChipVisible(0)).toBe(false);
    expect(scaleChipVisible(Number.NaN)).toBe(false);
    expect(scaleChipVisible(-1)).toBe(false);
  });
});

describe("saying the scale", () => {
  it("is a whole percentage", () => {
    expect(formatScale(0.62)).toBe("62%");
    expect(formatScale(0.5)).toBe("50%");
  });

  it("rounds down, so the chip never reads as the threshold it just crossed", () => {
    expect(formatScale(0.946)).toBe("94%");
  });

  it("never bottoms out at nothing", () => {
    // Only reachable from a grid drawn enormously wider than its pane, but a
    // chip reading "0%" says the terminal is gone rather than small.
    expect(formatScale(0.001)).toBe("1%");
  });
});
