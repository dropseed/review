import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

/**
 * Select mode, wired up: that a press opens it, that the four gestures the
 * pane already answers do not, and that what it opens is the screen as text.
 *
 * The word-boundary and snapshot arithmetic is `selection-text.test.ts` and
 * the timing is `long-press.test.ts`; this is the part where they meet a pane.
 * xterm is mocked out with the rest of the registry — jsdom has no canvas to
 * give a real one, and no layout either, so the pane's measurements are stubbed
 * to a phone-sized viewport showing a smaller grid.
 */

const mocks = vi.hoisted(() => ({
  scrollByDrag: vi.fn(),
  sendKey: vi.fn(),
  acquireTerminal: vi.fn(),
  /** What the fake terminal has on screen. */
  lines: [] as string[],
  onRender: vi.fn(),
}));

vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      {},
      {
        get: (_target, prop) =>
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
  cellWidth: () => 10,
  endDrag: vi.fn(),
  previewFontSize: vi.fn(),
  sendChar: vi.fn(),
  takeSteps: (carry: number, deltaPx: number, stepPx: number) => ({
    steps: Math.trunc((carry + deltaPx) / stepPx),
    carry: 0,
  }),
  onTerminalGrid: () => () => undefined,
  openLinkAt: () => false,
  requestFit: vi.fn(),
  scrollByDrag: mocks.scrollByDrag,
  sendKey: mocks.sendKey,
  setFitAction: vi.fn(),
  seedTerminalGridSize: vi.fn(),
  setTerminalMountPolicy: vi.fn(),
  setTerminalRemoteClaim: vi.fn(),
  setTerminalViewScale: vi.fn(),
  startTerminalOutput: vi.fn(),
  terminalGridSize: () => ({ cols: 80, rows: 4 }),
  terminalRemoteClaim: () => null,
  terminalReplayInFlight: () => false,
  refreshAllTerminalOptions: vi.fn(),
}));

import { TerminalPane } from "./TerminalPane";
import { LONG_PRESS_MS } from "./long-press";

/** A grid 800px wide inside a 400px pane: scaled, the way a phone draws it. */
const GRID = { width: 800, height: 80, rows: 4 };
const PANE = { width: 400, height: 400 };

function fakeTerminal() {
  const element = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  Object.defineProperty(screen, "offsetWidth", { value: GRID.width });
  Object.defineProperty(screen, "offsetHeight", { value: GRID.height });
  // The drawn rect, which is the natural grid at the scale it fits the pane
  // at — the same halving `applyScaledLayout` arrives at from these numbers.
  screen.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: GRID.width / 2,
      height: GRID.height / 2,
    }) as DOMRect;
  element.appendChild(screen);
  return {
    element,
    cols: 80,
    rows: GRID.rows,
    buffer: {
      active: {
        type: "normal",
        viewportY: 0,
        baseY: 0,
        getLine: (y: number) =>
          mocks.lines[y] === undefined
            ? undefined
            : { translateToString: () => mocks.lines[y].replace(/\s+$/, "") },
      },
      onBufferChange: () => ({ dispose: () => undefined }),
    },
    modes: { applicationCursorKeysMode: false },
    onData: () => ({ dispose: () => undefined }),
    onRender: mocks.onRender,
    // Watched by the jump-back-to-the-tail pill; nothing a selection does
    // reaches them (see `new-output`).
    onScroll: () => ({ dispose: () => undefined }),
    onWriteParsed: () => ({ dispose: () => undefined }),
    resize: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    scrollLines: vi.fn(),
    scrollToBottom: vi.fn(),
  };
}

function pane(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".touch-none");
  if (!el) throw new Error("terminal pane container not rendered");
  return el;
}

function overlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-terminal-selection]");
}

type Point = { clientX: number; clientY: number };

function touch(type: string, points: Point[], changed: Point[] = points): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches: points, changedTouches: changed });
  act(() => {
    pane().dispatchEvent(event);
  });
}

/** Run the clock far enough that a resting finger has meant something. */
function hold(ms = LONG_PRESS_MS): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.lines = ["npm run test", "", "ok — 12 passed", ""];
  mocks.onRender = vi.fn(() => ({ dispose: () => undefined }));
  // A phone: coarse pointer, no hover, narrow. Both queries the pane asks are
  // this device, so it mounts as a viewer *and* arms the press.
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom lays nothing out, and the scaled layout is measured, not declared.
  for (const [prop, value] of [
    ["clientWidth", PANE.width],
    ["clientHeight", PANE.height],
  ] as const) {
    Object.defineProperty(HTMLDivElement.prototype, prop, {
      configurable: true,
      value,
    });
  }
  mocks.acquireTerminal.mockImplementation(() => ({
    term: fakeTerminal(),
    fit: { fit: vi.fn() },
    isNew: false,
  }));
  render(<TerminalPane id="t1" active />);
  // The pane lays its drawing out in a frame, and the overlay is positioned on
  // those numbers.
  hold(20);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const prop of ["clientWidth", "clientHeight"]) {
    delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[
      prop
    ];
  }
  vi.clearAllMocks();
});

describe("a long press on a phone's terminal", () => {
  it("opens the screen as selectable text", () => {
    expect(overlay()).toBeNull();

    touch("touchstart", [{ clientX: 40, clientY: 5 }]);
    hold();

    const el = overlay();
    expect(el).not.toBeNull();
    // Every row of the grid, in order, blank ones included — the overlay sits
    // cell-for-cell on the drawing it hides.
    // A blank row is drawn as a no-break space: an empty box serializes to
    // nothing, which would close up the gaps in a copied selection.
    const rows = [...el!.querySelectorAll(":scope > div > div")].map((row) =>
      (row.textContent ?? "").replace(/\u00a0/g, ""),
    );
    expect(rows).toEqual(mocks.lines);
    const text = el!.querySelector<HTMLElement>("div");
    expect(text?.style.userSelect).toBe("text");
    // The pressed word arrives selected, so the handles and the callout are
    // there when the finger lifts — column 8 of row 0 is the "test" of
    // "npm run test".
    expect(window.getSelection()?.toString()).toBe("test");
  });

  it("does not open on a drag, which is what the same finger usually means", () => {
    touch("touchstart", [{ clientX: 40, clientY: 20 }]);
    hold(100);
    touch("touchmove", [{ clientX: 40, clientY: 200 }]);
    hold();

    expect(overlay()).toBeNull();
    expect(mocks.scrollByDrag).toHaveBeenCalled();
  });

  it("does not open on a pinch either", () => {
    touch("touchstart", [{ clientX: 40, clientY: 20 }]);
    hold(100);
    touch("touchstart", [
      { clientX: 40, clientY: 20 },
      { clientX: 200, clientY: 20 },
    ]);
    hold();

    expect(overlay()).toBeNull();
  });

  it("does not open on a tap, or after the finger has left", () => {
    touch("touchstart", [{ clientX: 40, clientY: 20 }]);
    hold(100);
    touch("touchend", [], [{ clientX: 40, clientY: 20 }]);
    hold();

    expect(overlay()).toBeNull();
  });

  it("closes on Done, handing the terminal back", () => {
    touch("touchstart", [{ clientX: 40, clientY: 20 }]);
    hold();
    const done = [...(overlay()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Done",
    );
    expect(done).toBeDefined();

    act(() => {
      done!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 0 }),
      );
    });
    expect(overlay()).toBeNull();
  });
});
