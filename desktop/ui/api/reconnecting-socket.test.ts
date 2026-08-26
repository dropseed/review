import { describe, it, expect } from "vitest";
import { backoffDelay } from "./reconnecting-socket";

describe("backoffDelay", () => {
  it("caps the ceiling at 8s regardless of attempt", () => {
    // rand=1 → delay == ceiling. Attempt 20 would be astronomically large
    // without the cap.
    expect(backoffDelay(20, () => 1)).toBe(8000);
    expect(backoffDelay(100, () => 1)).toBe(8000);
  });

  it("grows exponentially from 500ms until the cap", () => {
    const one = () => 1;
    expect(backoffDelay(0, one)).toBe(500);
    expect(backoffDelay(1, one)).toBe(1000);
    expect(backoffDelay(2, one)).toBe(2000);
    expect(backoffDelay(3, one)).toBe(4000);
    expect(backoffDelay(4, one)).toBe(8000); // 8000 is the cap
  });

  it("jitters within [ceiling/2, ceiling]", () => {
    expect(backoffDelay(0, () => 0)).toBe(250); // floor
    expect(backoffDelay(0, () => 1)).toBe(500); // ceiling
  });
});
