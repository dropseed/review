import { describe, it, expect } from "vitest";
import {
  PINCH_STEP_RATIO,
  lockAxis,
  pinchSteps,
  touchDistance,
} from "./touch-gestures";

const SLOP = 6;

describe("axis lock", () => {
  it("declines to answer while the finger is still inside the slop", () => {
    // The tap that focuses the shell moves a little; nothing may commit here
    // or the keyboard would stop coming up.
    expect(lockAxis(0, 0, SLOP)).toBeNull();
    expect(lockAxis(3, 3, SLOP)).toBeNull();
    expect(lockAxis(-5, 0, SLOP)).toBeNull();
  });

  it("commits to the axis the finger has travelled furthest along", () => {
    expect(lockAxis(20, 3, SLOP)).toBe("horizontal");
    expect(lockAxis(-20, 3, SLOP)).toBe("horizontal");
    expect(lockAxis(3, 20, SLOP)).toBe("vertical");
    expect(lockAxis(3, -20, SLOP)).toBe("vertical");
  });

  it("gives a tie to scrolling", () => {
    expect(lockAxis(10, 10, SLOP)).toBe("vertical");
  });

  it("counts diagonal travel toward leaving the slop", () => {
    // Neither axis is past 6 on its own, but the finger has moved 7px.
    expect(lockAxis(5, 5, SLOP)).toBe("vertical");
  });
});

describe("pinch", () => {
  it("measures the spread between two fingers", () => {
    expect(
      touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }),
    ).toBe(5);
  });

  it("does nothing until the fingers have moved a step's worth", () => {
    expect(pinchSteps(1)).toBe(0);
    expect(pinchSteps(1.05)).toBe(0);
  });

  it("steps up as the fingers spread and down as they close", () => {
    expect(pinchSteps(PINCH_STEP_RATIO)).toBe(1);
    expect(pinchSteps(PINCH_STEP_RATIO ** 3)).toBe(3);
    expect(pinchSteps(PINCH_STEP_RATIO ** -3)).toBe(-3);
  });

  it("is symmetric, so a pinch out and back lands where it started", () => {
    expect(pinchSteps(PINCH_STEP_RATIO ** -2)).toBe(-2);
    expect(pinchSteps(2)).toBe(-pinchSteps(0.5));
  });

  it("ignores a ratio that isn't a ratio", () => {
    // A pinch that started with the fingers already together divides by zero.
    expect(pinchSteps(0)).toBe(0);
    expect(pinchSteps(Number.POSITIVE_INFINITY)).toBe(0);
    expect(pinchSteps(Number.NaN)).toBe(0);
  });
});
