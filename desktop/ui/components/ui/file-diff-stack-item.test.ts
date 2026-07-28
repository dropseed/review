import { describe, it, expect } from "vitest";
import { applyCollapseShift, type CollapseShift } from "./file-diff-stack-item";

/** A stand-in for the scroll container: only `scrollTop` is ever touched. */
function scroller(scrollTop: number): HTMLElement {
  return { scrollTop } as HTMLElement;
}

function shift(
  el: HTMLElement,
  scrollTop: number,
  removedAbove: number,
): CollapseShift {
  return { scroller: el, scrollTop, removedAbove };
}

describe("applyCollapseShift", () => {
  it("holds the viewport still for a single collapse", () => {
    const el = scroller(3000);
    applyCollapseShift(shift(el, 3000, 1000));
    expect(el.scrollTop).toBe(2000);
  });

  it("composes collapses that all measured the same offset", async () => {
    // Three files, 1000px each, all above the fold, approved in one action:
    // every item measured 3000 before any of them unmounted.
    const el = scroller(3000);
    applyCollapseShift(shift(el, 3000, 1000));
    applyCollapseShift(shift(el, 3000, 1000));
    applyCollapseShift(shift(el, 3000, 1000));
    expect(el.scrollTop).toBe(0);
    await Promise.resolve();
  });

  it("composes partial removals in any order", async () => {
    const el = scroller(500);
    applyCollapseShift(shift(el, 500, 120));
    applyCollapseShift(shift(el, 500, 300));
    expect(el.scrollTop).toBe(80);
    await Promise.resolve();
  });

  it("keeps scrollers independent", async () => {
    const a = scroller(1000);
    const b = scroller(400);
    applyCollapseShift(shift(a, 1000, 100));
    applyCollapseShift(shift(b, 400, 50));
    applyCollapseShift(shift(a, 1000, 200));
    expect(a.scrollTop).toBe(700);
    expect(b.scrollTop).toBe(350);
    await Promise.resolve();
  });

  it("starts a fresh total for a later batch", async () => {
    const el = scroller(3000);
    applyCollapseShift(shift(el, 3000, 1000));
    expect(el.scrollTop).toBe(2000);

    // Layout effects for one commit run in a single synchronous block, so the
    // next batch is always at least a microtask away.
    await Promise.resolve();

    applyCollapseShift(shift(el, 2000, 500));
    expect(el.scrollTop).toBe(1500);
    await Promise.resolve();
  });
});
