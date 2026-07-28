import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

import { useSidebarResize } from "./useSidebarResize";
import { useReviewStore } from "../stores";
import { SIDEBAR_LIMITS } from "../utils/resize";

/** Frames under manual control — the drag's store write is rAF-throttled. */
let frames: FrameRequestCallback[] = [];

function runFrames(): void {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(performance.now());
}

const CANONICAL = SIDEBAR_LIMITS.right.defaultRem;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
  useReviewStore.setState({ filesPanelWidth: CANONICAL } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function startDrag(hook: { handleResizeStart: (e: never) => void }) {
  act(() => {
    hook.handleResizeStart({ preventDefault: () => {} } as never);
  });
}

describe("useSidebarResize", () => {
  it("commits the dragged width once per frame", () => {
    const { result } = renderHook(() =>
      useSidebarResize({ sidebarPosition: "right" }),
    );
    startDrag(result.current);

    // Right-hand panel: width is the distance from the window's right edge.
    act(() => {
      fireEvent.mouseMove(document, { clientX: window.innerWidth - 480 });
    });
    expect(useReviewStore.getState().filesPanelWidth).toBe(CANONICAL);

    act(() => runFrames());
    expect(useReviewStore.getState().filesPanelWidth).toBe(30);
  });

  it("drops a frame still in flight when the drag ends", () => {
    const { result } = renderHook(() =>
      useSidebarResize({ sidebarPosition: "right" }),
    );
    startDrag(result.current);

    // The pointer wobble between the second mousedown and mouseup of a
    // double-click on the handle.
    act(() => {
      fireEvent.mouseMove(document, { clientX: window.innerWidth - 480 });
      fireEvent.mouseUp(document);
    });

    // The handle's double-click has already snapped the panel back.
    act(() => {
      useReviewStore.getState().setSidebarWidth("filesPanelWidth", CANONICAL);
    });

    act(() => runFrames());
    expect(useReviewStore.getState().filesPanelWidth).toBe(CANONICAL);
  });
});
