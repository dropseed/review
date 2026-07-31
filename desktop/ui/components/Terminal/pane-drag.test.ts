import { describe, it, expect } from "vitest";
import { edgeForPoint } from "./pane-drag";

describe("edgeForPoint", () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };

  it("picks the edge the point is nearest", () => {
    expect(edgeForPoint(rect, 110, 100)).toBe("left");
    expect(edgeForPoint(rect, 290, 100)).toBe("right");
    expect(edgeForPoint(rect, 200, 55)).toBe("top");
    expect(edgeForPoint(rect, 200, 145)).toBe("bottom");
  });

  it("compares in fractions, so a narrow pane still has a top and a bottom", () => {
    // 60px from the left of a 120px-wide pane is half its width, but only a
    // tenth of its height from the top — an absolute comparison would call
    // this "left" and leave stacking unreachable in the docked panel.
    const tall = { left: 0, top: 0, width: 120, height: 600 };
    expect(edgeForPoint(tall, 60, 60)).toBe("top");
    expect(edgeForPoint(tall, 60, 540)).toBe("bottom");
    expect(edgeForPoint(tall, 10, 300)).toBe("left");
  });

  it("treats a zero-sized rect as centered rather than dividing by it", () => {
    expect(edgeForPoint({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe(
      "left",
    );
  });
});
