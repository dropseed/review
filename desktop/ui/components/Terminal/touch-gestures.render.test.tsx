import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

/**
 * The pane's touch layer, wired up: which registry verb each gesture reaches.
 *
 * The arithmetic is `touch-gestures.test.ts`; this is the other half — that a
 * horizontal drag becomes cursor keys rather than a scroll, that a second
 * finger cancels whatever one finger had started, and that a pinch touches the
 * shared grid exactly once, at the end.
 *
 * xterm is mocked out along with the rest of the registry: none of this needs
 * a real terminal, and jsdom has no canvas to give one.
 */

const mocks = vi.hoisted(() => ({
  scrollByDrag: vi.fn(),
  sendKey: vi.fn(),
  requestFit: vi.fn(),
  endDrag: vi.fn(),
  acquireTerminal: vi.fn(),
  previewFontSize: vi.fn(),
  /** One cell is 10px wide: 800px of screen over 80 columns. */
  cellWidth: 10,
}));

vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      {},
      {
        get: (_target, prop) =>
          // A subscription hands back an unsubscribe, not a promise — React
          // calls it at teardown, and a pane unmounts on every tab switch.
          prop === "onTerminalConnection"
            ? () => () => undefined
            : () => Promise.resolve(undefined),
      },
    ),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));
vi.mock("./registry", () => ({
  MAX_KEYS_PER_DRAG_EVENT: 8,
  acquireTerminal: mocks.acquireTerminal,
  attachRenderer: vi.fn(),
  beginTerminalReplay: vi.fn(),
  cellWidth: () => mocks.cellWidth,
  endDrag: mocks.endDrag,
  previewFontSize: mocks.previewFontSize,
  sendChar: vi.fn(),
  // The carry arithmetic belongs to registry and is tested there; every swipe
  // in this file is a single move event, so whole cells is all this owes.
  takeSteps: (carry: number, deltaPx: number, stepPx: number) => ({
    steps: Math.trunc((carry + deltaPx) / stepPx),
    carry: 0,
  }),
  onTerminalGrid: () => () => undefined,
  openLinkAt: () => false,
  requestFit: mocks.requestFit,
  scrollByDrag: mocks.scrollByDrag,
  sendKey: mocks.sendKey,
  setFitAction: vi.fn(),
  seedTerminalGridSize: vi.fn(),
  setTerminalMountPolicy: vi.fn(),
  setTerminalRemoteClaim: vi.fn(),
  setTerminalViewScale: vi.fn(),
  terminalViewScale: () => 1,
  startTerminalOutput: vi.fn(),
  terminalGridSize: () => null,
  terminalRemoteClaim: () => null,
  terminalReplayInFlight: () => false,
  refreshAllTerminalOptions: vi.fn(),
}));

import { TerminalPane } from "./TerminalPane";
import { useReviewStore } from "../../stores";
import { PINCH_STEP_RATIO } from "./touch-gestures";

const CELL_WIDTH = mocks.cellWidth;

function fakeTerminal() {
  const element = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  // jsdom lays nothing out, and the swipe measures itself against a cell.
  Object.defineProperty(screen, "offsetWidth", { value: 800 });
  element.appendChild(screen);
  return {
    element,
    cols: 80,
    rows: 24,
    buffer: {
      active: { type: "normal", viewportY: 0, baseY: 0 },
      onBufferChange: () => ({ dispose: () => undefined }),
    },
    modes: { applicationCursorKeysMode: false },
    onData: () => ({ dispose: () => undefined }),
    // The pill that offers a jump back to the tail watches all three; none of
    // them has anything to say about a gesture (see `new-output`).
    onScroll: () => ({ dispose: () => undefined }),
    onWriteParsed: () => ({ dispose: () => undefined }),
    resize: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    scrollLines: vi.fn(),
    scrollToBottom: vi.fn(),
  };
}

/** The pane's own container — the element carrying the touch listeners. */
function pane(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".touch-none");
  if (!el) throw new Error("terminal pane container not rendered");
  return el;
}

type Point = { clientX: number; clientY: number };

/** jsdom implements neither TouchEvent nor Touch; the handlers read neither. */
function touch(type: string, points: Point[], changed: Point[] = points): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches: points, changedTouches: changed });
  act(() => {
    pane().dispatchEvent(event);
  });
}

/** Let the rAF the pinch defers its fit into actually run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

beforeEach(() => {
  // jsdom has none, and the pane watches its container for resizes. Nothing
  // here ever resizes, so observing is all it has to do.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.acquireTerminal.mockImplementation(() => ({
    term: fakeTerminal(),
    fit: { fit: vi.fn() },
    isNew: false,
  }));
  render(<TerminalPane id="t1" active />);
});

afterEach(() => {
  cleanup();
  useReviewStore.setState({ terminalFontSize: 13 });
  vi.clearAllMocks();
});

describe("a drag on a terminal", () => {
  it("scrolls when it went up or down", () => {
    touch("touchstart", [{ clientX: 100, clientY: 300 }]);
    touch("touchmove", [{ clientX: 102, clientY: 260 }]);

    // A finger moving up drags the text up with it: a positive delta, the sign
    // a wheel uses for the same movement.
    expect(mocks.scrollByDrag).toHaveBeenCalledWith(
      "t1",
      expect.anything(),
      40,
    );
    expect(mocks.sendKey).not.toHaveBeenCalled();
  });

  it("sends cursor keys when it went sideways, one per cell", () => {
    touch("touchstart", [{ clientX: 100, clientY: 300 }]);
    touch("touchmove", [{ clientX: 100 + CELL_WIDTH * 3, clientY: 302 }]);

    // One call, not three: the repeat is the encoder's, so a swipe is one
    // encode and one write however many cells it crossed.
    expect(mocks.sendKey).toHaveBeenCalledTimes(1);
    expect(mocks.sendKey).toHaveBeenCalledWith("t1", "right", { count: 3 });
    expect(mocks.scrollByDrag).not.toHaveBeenCalled();
  });

  it("follows the finger backwards", () => {
    touch("touchstart", [{ clientX: 200, clientY: 300 }]);
    touch("touchmove", [{ clientX: 200 - CELL_WIDTH * 2, clientY: 300 }]);

    expect(mocks.sendKey).toHaveBeenCalledWith("t1", "left", { count: 2 });
  });

  it("caps a flick, which is otherwise dozens of keypresses in one event", () => {
    touch("touchstart", [{ clientX: 20, clientY: 300 }]);
    touch("touchmove", [{ clientX: 20 + CELL_WIDTH * 200, clientY: 300 }]);

    expect(mocks.sendKey).toHaveBeenCalledWith("t1", "right", { count: 8 });
  });

  /**
   * The lock is what keeps a thumb honest: a scroll that drifts sideways would
   * otherwise start editing the command line halfway down the screen.
   */
  it("keeps the axis it committed to for the rest of the gesture", () => {
    touch("touchstart", [{ clientX: 100, clientY: 300 }]);
    touch("touchmove", [{ clientX: 100, clientY: 260 }]);
    // Now sideways, further than it ever went vertically.
    touch("touchmove", [{ clientX: 300, clientY: 260 }]);

    expect(mocks.sendKey).not.toHaveBeenCalled();
    expect(mocks.scrollByDrag).toHaveBeenCalled();
  });

  it("does nothing at all inside the slop, so a tap still lands", () => {
    touch("touchstart", [{ clientX: 100, clientY: 300 }]);
    touch("touchmove", [{ clientX: 103, clientY: 302 }]);

    expect(mocks.scrollByDrag).not.toHaveBeenCalled();
    expect(mocks.sendKey).not.toHaveBeenCalled();
  });
});

describe("a pinch on a terminal", () => {
  it("sizes the text live, and commits it once, at the end", async () => {
    touch("touchstart", [
      { clientX: 100, clientY: 300 },
      { clientX: 200, clientY: 300 },
    ]);
    touch("touchmove", [
      { clientX: 100, clientY: 300 },
      { clientX: 100 + 100 * PINCH_STEP_RATIO ** 3, clientY: 300 },
    ]);

    // Drawn at the new size, but nothing else knows yet: storing it writes
    // localStorage and refits every owner terminal in the app, and a fit
    // resizes the PTY every client shares.
    expect(mocks.previewFontSize).toHaveBeenCalledWith("t1", 16);
    expect(useReviewStore.getState().terminalFontSize).toBe(13);
    expect(mocks.requestFit).not.toHaveBeenCalled();

    touch("touchend", [], [{ clientX: 100, clientY: 300 }]);
    expect(useReviewStore.getState().terminalFontSize).toBe(16);
    await settle();
    expect(mocks.requestFit).toHaveBeenCalledTimes(1);
  });

  it("closes the fingers to make the text smaller", async () => {
    touch("touchstart", [
      { clientX: 100, clientY: 300 },
      { clientX: 200, clientY: 300 },
    ]);
    touch("touchmove", [
      { clientX: 100, clientY: 300 },
      { clientX: 100 + 100 * PINCH_STEP_RATIO ** -2, clientY: 300 },
    ]);
    touch("touchend", [], [{ clientX: 100, clientY: 300 }]);
    // Let the commit's deferred fit run inside this test rather than leaking
    // into the next one.
    await settle();

    expect(useReviewStore.getState().terminalFontSize).toBe(11);
  });

  it("leaves the grid alone when the fingers only rested there", async () => {
    touch("touchstart", [
      { clientX: 100, clientY: 300 },
      { clientX: 200, clientY: 300 },
    ]);
    touch("touchmove", [
      { clientX: 100, clientY: 300 },
      { clientX: 203, clientY: 300 },
    ]);
    touch("touchend", [], [{ clientX: 100, clientY: 300 }]);
    await settle();

    expect(mocks.previewFontSize).not.toHaveBeenCalled();
    expect(useReviewStore.getState().terminalFontSize).toBe(13);
    expect(mocks.requestFit).not.toHaveBeenCalled();
  });

  it("cancels a drag the first finger had already started", () => {
    touch("touchstart", [{ clientX: 100, clientY: 300 }]);
    touch("touchmove", [{ clientX: 100, clientY: 250 }]);
    expect(mocks.scrollByDrag).toHaveBeenCalledTimes(1);

    touch("touchstart", [
      { clientX: 100, clientY: 250 },
      { clientX: 200, clientY: 250 },
    ]);
    touch("touchmove", [
      { clientX: 100, clientY: 120 },
      { clientX: 200, clientY: 120 },
    ]);

    // Both fingers travelled 130px up the screen; none of it scrolled.
    expect(mocks.scrollByDrag).toHaveBeenCalledTimes(1);
  });

  it("does not let the finger left behind start a drag of its own", () => {
    touch("touchstart", [
      { clientX: 100, clientY: 300 },
      { clientX: 200, clientY: 300 },
    ]);
    touch(
      "touchend",
      [{ clientX: 100, clientY: 300 }],
      [{ clientX: 200, clientY: 300 }],
    );
    touch("touchmove", [{ clientX: 100, clientY: 200 }]);

    expect(mocks.scrollByDrag).not.toHaveBeenCalled();
    expect(mocks.sendKey).not.toHaveBeenCalled();
  });
});
