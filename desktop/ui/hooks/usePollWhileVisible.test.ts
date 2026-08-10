import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePollWhileVisible } from "./usePollWhileVisible";

/** jsdom's visibilityState is read-only, so stand in for it. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("usePollWhileVisible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("polls on the interval, and not before", () => {
    const poll = vi.fn();
    renderHook(() => usePollWhileVisible(poll, 1000));

    // Mounting starts the timer without firing: callers own their first read.
    expect(poll).not.toHaveBeenCalled();
    advance(1000);
    expect(poll).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("stops while hidden and catches up on return", () => {
    const poll = vi.fn();
    renderHook(() => usePollWhileVisible(poll, 1000));

    setVisibility("hidden");
    advance(5000);
    expect(poll).not.toHaveBeenCalled();

    // Returning polls immediately rather than waiting out an interval that
    // wasn't running — seeing the current state is why you came back.
    setVisibility("visible");
    expect(poll).toHaveBeenCalledTimes(1);
    advance(1000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("keeps the timer running when the callback identity changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ poll }: { poll: () => void }) => usePollWhileVisible(poll, 1000),
      { initialProps: { poll: first } },
    );

    advance(600);
    rerender({ poll: second });
    // A restarted interval would need a further 1000ms, not the remaining 400.
    advance(400);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("polls on window focus only when asked", () => {
    const plain = vi.fn();
    const focused = vi.fn();
    renderHook(() => usePollWhileVisible(plain, 1000));
    renderHook(() => usePollWhileVisible(focused, 1000, { onFocus: true }));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(plain).not.toHaveBeenCalled();
    expect(focused).toHaveBeenCalledTimes(1);
  });

  it("stops polling once unmounted", () => {
    const poll = vi.fn();
    const { unmount } = renderHook(() => usePollWhileVisible(poll, 1000));

    unmount();
    advance(5000);
    expect(poll).not.toHaveBeenCalled();
    // The listeners go with it, so a later visibility change is inert too.
    setVisibility("hidden");
    setVisibility("visible");
    expect(poll).not.toHaveBeenCalled();
  });
});
