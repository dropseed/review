import { describe, it, expect, vi } from "vitest";
import {
  SIDEBAR_LIMITS,
  SIDEBAR_MAX_VIEWPORT_FRACTION,
  clampFraction,
  clampPanelWidthPx,
  clampSidebarWidth,
  rafThrottle,
  toggleToCanonical,
} from "./resize";

describe("clampSidebarWidth", () => {
  const limits = { minRem: 10, maxRem: 24 };

  it("leaves a width the window can afford alone", () => {
    expect(
      clampSidebarWidth(14, {
        ...limits,
        viewportPx: 1920,
        rootFontSizePx: 16,
      }),
    ).toBe(14);
  });

  it("holds the width inside the panel's own bounds", () => {
    const opts = { ...limits, viewportPx: 5120, rootFontSizePx: 16 };
    expect(clampSidebarWidth(4, opts)).toBe(10);
    expect(clampSidebarWidth(100, opts)).toBe(24);
  });

  it("caps a width chosen on a big display when the window is small", () => {
    // 24rem = 384px, but a 900px window only spares 300px = 18.75rem.
    expect(
      clampSidebarWidth(24, { ...limits, viewportPx: 900, rootFontSizePx: 16 }),
    ).toBe(18.75);
  });

  it("keeps the chosen width intact so a bigger display restores it", () => {
    const chosen = 24;
    const laptop = clampSidebarWidth(chosen, {
      ...limits,
      viewportPx: 900,
      rootFontSizePx: 16,
    });
    const ultrawide = clampSidebarWidth(chosen, {
      ...limits,
      viewportPx: 3440,
      rootFontSizePx: 16,
    });
    expect(laptop).toBeLessThan(chosen);
    expect(ultrawide).toBe(chosen);
  });

  it("converts against the current root font size, not a fixed 16px", () => {
    // At a 1.5x UI scale the same 900px window spares only 12.5rem.
    expect(
      clampSidebarWidth(24, { ...limits, viewportPx: 900, rootFontSizePx: 24 }),
    ).toBe(12.5);
  });

  it("never clamps below the minimum, however narrow the window", () => {
    expect(
      clampSidebarWidth(14, { ...limits, viewportPx: 200, rootFontSizePx: 16 }),
    ).toBe(10);
  });

  it("skips the window cap when there is nothing measured to cap against", () => {
    expect(
      clampSidebarWidth(20, { ...limits, viewportPx: 0, rootFontSizePx: 16 }),
    ).toBe(20);
  });

  it("falls back to the minimum for a corrupt stored width", () => {
    expect(
      clampSidebarWidth(NaN, {
        ...limits,
        viewportPx: 1920,
        rootFontSizePx: 16,
      }),
    ).toBe(10);
  });

  it("leaves room for the diff with both panels at their widest", () => {
    const viewportPx = 1440;
    const left = clampSidebarWidth(SIDEBAR_LIMITS.left.maxRem, {
      minRem: SIDEBAR_LIMITS.left.minRem,
      maxRem: SIDEBAR_LIMITS.left.maxRem,
      viewportPx,
      rootFontSizePx: 16,
    });
    const right = clampSidebarWidth(SIDEBAR_LIMITS.right.maxRem, {
      minRem: SIDEBAR_LIMITS.right.minRem,
      maxRem: SIDEBAR_LIMITS.right.maxRem,
      viewportPx,
      rootFontSizePx: 16,
    });
    expect((left + right) * 16).toBeLessThanOrEqual(
      viewportPx * SIDEBAR_MAX_VIEWPORT_FRACTION * 2,
    );
  });
});

describe("clampFraction", () => {
  it("holds a fraction inside the content-split bounds", () => {
    expect(clampFraction(0.5)).toBe(0.5);
    expect(clampFraction(0.02)).toBe(0.2);
    expect(clampFraction(0.99)).toBe(0.8);
  });

  it("recentres a non-finite fraction", () => {
    expect(clampFraction(NaN)).toBe(0.5);
  });
});

describe("clampPanelWidthPx", () => {
  it("caps the panel at its share of the container", () => {
    expect(clampPanelWidthPx(900, 1000, 0.75)).toBe(750);
  });

  it("leaves a width the container can afford alone", () => {
    expect(clampPanelWidthPx(480, 1000, 0.75)).toBe(480);
  });

  it("passes the width through before the container is measured", () => {
    expect(clampPanelWidthPx(480, 0, 0.75)).toBe(480);
  });

  it("is a pure render-time cap — the same chosen width survives a bigger container", () => {
    const chosen = 900;
    expect(clampPanelWidthPx(chosen, 1000, 0.75)).toBe(750);
    expect(clampPanelWidthPx(chosen, 3440, 0.75)).toBe(900);
  });
});

describe("toggleToCanonical", () => {
  it("snaps to the canonical size and remembers where it was", () => {
    expect(toggleToCanonical(18, 14, null, 24, 0.01)).toEqual({
      next: 14,
      remember: 18,
    });
  });

  it("restores the remembered size on the next call", () => {
    const first = toggleToCanonical(18, 14, null, 24, 0.01);
    expect(toggleToCanonical(first.next, 14, first.remember, 24, 0.01)).toEqual(
      { next: 18, remember: null },
    );
  });

  it("round-trips: the same gesture always undoes itself", () => {
    let value = 21;
    let remembered: number | null = null;
    for (let i = 0; i < 4; i++) {
      const step = toggleToCanonical(value, 14, remembered, 24, 0.01);
      value = step.next;
      remembered = step.remember;
    }
    expect(value).toBe(21);
  });

  it("uses the fallback when it starts at the canonical size", () => {
    expect(toggleToCanonical(14, 14, null, 24, 0.01)).toEqual({
      next: 24,
      remember: null,
    });
  });

  it("does nothing when the fallback is the canonical size", () => {
    expect(toggleToCanonical(0.5, 0.5, null, 0.5, 0.005)).toEqual({
      next: 0.5,
      remember: null,
    });
  });

  it("treats a size within epsilon as already canonical", () => {
    expect(toggleToCanonical(0.502, 0.5, 0.8, 0.5, 0.005).next).toBe(0.8);
  });
});

describe("rafThrottle", () => {
  it("collapses a burst into one call with the newest arguments", async () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn).not.toHaveBeenCalled();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("drops a pending call when cancelled", async () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled(1);
    throttled.cancel();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(fn).not.toHaveBeenCalled();
  });
});
