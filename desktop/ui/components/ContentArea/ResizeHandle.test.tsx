import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ResizeHandle } from "./ResizeHandle";

/**
 * Frames under manual control: the drag commit is rAF-throttled, so "did a
 * pending frame land after the gesture ended" is the whole question here.
 */
let frames: FrameRequestCallback[] = [];

function runFrames(): void {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(performance.now());
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(onResize: (f: number) => void, onReset?: () => void) {
  const { container } = render(
    <div>
      <ResizeHandle
        orientation="horizontal"
        onResize={onResize}
        onReset={onReset}
      />
    </div>,
  );
  const handle = container.firstElementChild!.firstElementChild as HTMLElement;
  // jsdom does no layout; the drag needs a container width to divide by.
  handle.parentElement!.getBoundingClientRect = () =>
    ({ left: 0, width: 1000, top: 0, height: 1000 }) as DOMRect;
  return handle;
}

describe("ResizeHandle", () => {
  it("commits one drag position per frame", () => {
    const onResize = vi.fn();
    const handle = mount(onResize);

    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 400 });
    expect(onResize).not.toHaveBeenCalled();

    runFrames();
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenLastCalledWith(0.4);
  });

  it("drops a frame still in flight when the drag ends", () => {
    const onResize = vi.fn();
    const onReset = vi.fn();
    const handle = mount(onResize, onReset);

    // The wobble between the second mousedown and mouseup of a double-click.
    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);
    fireEvent.doubleClick(handle);

    // The reset already ran; a late frame would write the dragged fraction
    // back over it and the double-click would look like it did nothing.
    runFrames();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onResize).not.toHaveBeenCalled();
  });
});
