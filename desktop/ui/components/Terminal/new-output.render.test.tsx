import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

/**
 * The pill, wired up: which of xterm's events reach the rules in `new-output`,
 * and what the tap does.
 *
 * The rules themselves are `new-output.test.ts`. This is the other half — that
 * the pane is asking the buffer the right question at the right moment, and
 * that the tap is `scrollToBottom` and not a scroll of its own.
 */

const mocks = vi.hoisted(() => ({
  acquireTerminal: vi.fn(),
  scrollToBottom: vi.fn(),
  /** The live buffer position, which each test moves under the pane. */
  buffer: { viewportY: 0, baseY: 0, type: "normal" as "normal" | "alternate" },
  /** xterm's listeners, kept so a test can fire one. */
  listeners: {
    scroll: [] as (() => void)[],
    writeParsed: [] as (() => void)[],
    bufferChange: [] as (() => void)[],
  },
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
  takeSteps: () => ({ steps: 0, carry: 0 }),
  onTerminalGrid: () => () => undefined,
  openLinkAt: () => false,
  requestFit: vi.fn(),
  scrollByDrag: vi.fn(),
  sendKey: vi.fn(),
  setFitAction: vi.fn(),
  seedTerminalGridSize: vi.fn(),
  setTerminalMountPolicy: vi.fn(),
  setTerminalRemoteClaim: vi.fn(),
  setTerminalViewScale: vi.fn(),
  startTerminalOutput: vi.fn(),
  terminalGridSize: () => null,
  terminalRemoteClaim: () => null,
  terminalReplayInFlight: () => false,
  refreshAllTerminalOptions: vi.fn(),
}));

import { TerminalPane } from "./TerminalPane";

function subscribe(into: (() => void)[]) {
  return (listener: () => void) => {
    into.push(listener);
    return {
      dispose: () => {
        const at = into.indexOf(listener);
        if (at >= 0) into.splice(at, 1);
      },
    };
  };
}

function fakeTerminal() {
  const element = document.createElement("div");
  const screenEl = document.createElement("div");
  screenEl.className = "xterm-screen";
  Object.defineProperty(screenEl, "offsetWidth", { value: 800 });
  Object.defineProperty(screenEl, "offsetHeight", { value: 400 });
  element.appendChild(screenEl);
  return {
    element,
    cols: 80,
    rows: 24,
    buffer: {
      active: mocks.buffer,
      onBufferChange: subscribe(mocks.listeners.bufferChange),
    },
    modes: { applicationCursorKeysMode: false },
    onData: () => ({ dispose: () => undefined }),
    onScroll: subscribe(mocks.listeners.scroll),
    onWriteParsed: subscribe(mocks.listeners.writeParsed),
    resize: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    scrollLines: vi.fn(),
    scrollToBottom: mocks.scrollToBottom,
  };
}

/** Move the viewport up `rows` rows from the tail, and tell xterm's listeners. */
function scrollUp(rows: number): void {
  mocks.buffer.baseY = 500;
  mocks.buffer.viewportY = 500 - rows;
  act(() => {
    for (const listener of mocks.listeners.scroll) listener();
  });
}

/** Put the viewport back at the tail, as a drag or a wheel would. */
function scrollToTail(): void {
  mocks.buffer.viewportY = mocks.buffer.baseY;
  act(() => {
    for (const listener of mocks.listeners.scroll) listener();
  });
}

/** Bytes land while nobody has scrolled: xterm follows its own tail. */
function output(): void {
  mocks.buffer.baseY += 1;
  mocks.buffer.viewportY = mocks.buffer.baseY;
  fireWrite();
}

/** Bytes land under a viewport that is parked up in the scrollback. */
function outputWhileAway(): void {
  mocks.buffer.baseY += 1;
  fireWrite();
}

function fireWrite(): void {
  act(() => {
    for (const listener of mocks.listeners.writeParsed) listener();
  });
}

function switchScreen(to: "normal" | "alternate"): void {
  mocks.buffer.type = to;
  act(() => {
    for (const listener of mocks.listeners.bufferChange) listener();
  });
}

function pill(): HTMLElement | null {
  return screen.queryByRole("button", { name: /new output/i });
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.buffer.viewportY = 0;
  mocks.buffer.baseY = 0;
  mocks.buffer.type = "normal";
  mocks.listeners.scroll = [];
  mocks.listeners.writeParsed = [];
  mocks.listeners.bufferChange = [];
  mocks.acquireTerminal.mockImplementation(() => ({
    term: fakeTerminal(),
    fit: { fit: vi.fn() },
    isNew: false,
  }));
  render(<TerminalPane id="t1" active />);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the new-output pill", () => {
  it("is not there on a terminal being watched at the bottom", () => {
    output();
    output();
    expect(pill()).toBeNull();
  });

  it("is not there merely because the reader scrolled up", () => {
    scrollUp(20);
    expect(pill()).toBeNull();
  });

  it("appears when bytes land below a reader who scrolled up", () => {
    scrollUp(20);
    outputWhileAway();
    expect(pill()).not.toBeNull();
  });

  it("goes when the reader drags back down to the tail", () => {
    scrollUp(20);
    outputWhileAway();
    scrollToTail();
    expect(pill()).toBeNull();
  });

  it("jumps to the bottom when tapped, and takes itself away", () => {
    scrollUp(20);
    outputWhileAway();
    const button = pill();
    if (!button) throw new Error("the pill should be showing");
    // The tap has to land on the buffer, not scroll the pane's own DOM: the
    // scrollback viewport is a sibling of the screen a finger lands on.
    mocks.scrollToBottom.mockImplementation(() => {
      mocks.buffer.viewportY = mocks.buffer.baseY;
    });
    act(() => button.click());
    expect(mocks.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(pill()).toBeNull();
  });

  it("never appears over a full-screen program", () => {
    // The alternate screen has no scrollback to be away from, and its repaints
    // are not news.
    switchScreen("alternate");
    scrollUp(20);
    outputWhileAway();
    expect(pill()).toBeNull();
  });

  it("clears what the normal screen had missed when one takes over", () => {
    scrollUp(20);
    outputWhileAway();
    expect(pill()).not.toBeNull();
    switchScreen("alternate");
    expect(pill()).toBeNull();
  });
});
