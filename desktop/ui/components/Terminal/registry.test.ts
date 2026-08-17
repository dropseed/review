import { describe, it, expect, afterEach, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { buildXtermTheme } from "./xterm-theme";
import type { TerminalFontOptions } from "./registry";

// getApiClient() has an HMR-cache path (import.meta.hot.data) that only
// exists under Vite's dev server, not under vitest — mock it here rather
// than touching api/index.ts, which is outside this change's scope.
const terminalResize = vi.fn().mockResolvedValue(undefined);
/** Output listeners registered by the registry, keyed by terminal id. */
const outputListeners = new Map<
  string,
  (chunk: { data: Uint8Array; seq: number }) => void
>();
const unsubOutput = vi.fn();
/** Resized listeners registered by the registry, keyed by terminal id. */
const resizedListeners = new Map<
  string,
  (resized: { id: string; cols: number; rows: number }) => void
>();
const unsubResized = vi.fn();
vi.mock("../../api", () => ({
  getApiClient: () => ({
    terminalResize,
    onTerminalOutput: (
      id: string,
      cb: (chunk: { data: Uint8Array; seq: number }) => void,
    ) => {
      outputListeners.set(id, cb);
      return () => {
        outputListeners.delete(id);
        unsubOutput();
      };
    },
    onTerminalResized: (
      id: string,
      cb: (resized: { id: string; cols: number; rows: number }) => void,
    ) => {
      resizedListeners.set(id, cb);
      return () => {
        resizedListeners.delete(id);
        unsubResized();
      };
    },
  }),
}));

/** Push a PTY output chunk at the registry, as the transport would. */
function emitOutput(id: string, text: string, seq: number): void {
  outputListeners.get(id)?.({ data: new TextEncoder().encode(text), seq });
}

/** Push a PTY-resized event at the registry, as the transport would. */
function emitResized(id: string, cols: number, rows: number): void {
  resizedListeners.get(id)?.({ id, cols, rows });
}

// The WebGL addon needs a real GPU context that jsdom lacks, so instantiating
// it throws. That's fine for these tests: attachRenderer swallows construction
// failures. We assert the code path runs, not that a real addon attaches.
const {
  acquireTerminal,
  beginTerminalReplay,
  disposeTerminal,
  forgetCellHeight,
  normalizeWheel,
  onTerminalGrid,
  refreshAllTerminalOptions,
  refreshAllTerminalThemes,
  attachRenderer,
  seedTerminalGridSize,
  setTerminalMountPolicy,
  setTerminalRemoteClaim,
  startTerminalOutput,
  hasTerminal,
  terminalGridSize,
  terminalRemoteClaim,
  terminalReplayInFlight,
} = await import("./registry");

const ids: string[] = [];

const FONT_OPTS: TerminalFontOptions = {
  fontFamily: "monospace",
  fontSize: 13,
  fontWeight: 400,
  fontWeightBold: 700,
  lineHeight: 1.0,
  letterSpacing: 0,
};

/** Acquire a terminal and track it for cleanup. */
function acquire(id: string) {
  ids.push(id);
  return acquireTerminal(id, { ...FONT_OPTS, theme: buildXtermTheme() });
}

afterEach(() => {
  while (ids.length) disposeTerminal(ids.pop()!);
  document.documentElement.removeAttribute("style");
  terminalResize.mockClear();
  unsubOutput.mockClear();
  outputListeners.clear();
  unsubResized.mockClear();
  resizedListeners.clear();
});

describe("replay-in-flight guard", () => {
  it("tracks the round trip so a remount can decline to flush", () => {
    acquire("t-replay");
    expect(terminalReplayInFlight("t-replay")).toBe(false);

    // First mount starts a replay; a StrictMode remount lands inside it and
    // must see the flag rather than releasing the held-back output itself.
    beginTerminalReplay("t-replay");
    expect(terminalReplayInFlight("t-replay")).toBe(true);

    // The fetch resolves (or fails — both paths end here) and releases.
    startTerminalOutput("t-replay");
    expect(terminalReplayInFlight("t-replay")).toBe(false);
  });
});

describe("grid tracking", () => {
  it("records the daemon's resizes and notifies grid listeners", () => {
    acquire("t-grid");
    expect(terminalGridSize("t-grid")).toBeNull();

    const seen: Array<{ cols: number; rows: number }> = [];
    const unsub = onTerminalGrid("t-grid", (size) => seen.push(size));

    emitResized("t-grid", 100, 30);
    expect(terminalGridSize("t-grid")).toEqual({ cols: 100, rows: 30 });
    expect(seen).toEqual([{ cols: 100, rows: 30 }]);

    unsub();
    emitResized("t-grid", 80, 24);
    expect(seen).toHaveLength(1);
    expect(terminalGridSize("t-grid")).toEqual({ cols: 80, rows: 24 });
  });

  it("seeds from a session listing but never overwrites a live report", () => {
    acquire("t-seed");
    seedTerminalGridSize("t-seed", { cols: 120, rows: 40 });
    expect(terminalGridSize("t-seed")).toEqual({ cols: 120, rows: 40 });

    emitResized("t-seed", 100, 30);
    seedTerminalGridSize("t-seed", { cols: 120, rows: 40 });
    expect(terminalGridSize("t-seed")).toEqual({ cols: 100, rows: 30 });
  });

  it("unsubscribes the resized stream on dispose", () => {
    acquire("t-unsub");
    expect(resizedListeners.has("t-unsub")).toBe(true);
    disposeTerminal(ids.pop()!);
    expect(resizedListeners.has("t-unsub")).toBe(false);
    expect(unsubResized).toHaveBeenCalledTimes(1);
  });
});

describe("font refresh under a viewer mount", () => {
  it("relays a font change to viewer listeners instead of resizing the PTY", () => {
    acquire("t-viewer");
    setTerminalMountPolicy("t-viewer", "viewer");
    emitResized("t-viewer", 141, 52);
    const seen: Array<{ cols: number; rows: number }> = [];
    onTerminalGrid("t-viewer", (size) => seen.push(size));

    refreshAllTerminalOptions({ ...FONT_OPTS, fontSize: 15 });

    // A font change on this screen is no reason to reflow the shared PTY —
    // the pane re-lays out through its grid listener, at the PTY's grid.
    expect(terminalResize).not.toHaveBeenCalled();
    expect(seen).toEqual([{ cols: 141, rows: 52 }]);
  });

  it("rescales instead of refitting an owner whose grid is claimed elsewhere", () => {
    acquire("t-claimed");
    setTerminalMountPolicy("t-claimed", "owner");
    emitResized("t-claimed", 60, 20);
    setTerminalRemoteClaim("t-claimed", { cols: 60, rows: 20 });
    const seen: Array<{ cols: number; rows: number }> = [];
    onTerminalGrid("t-claimed", (size) => seen.push(size));

    refreshAllTerminalOptions({ ...FONT_OPTS, fontSize: 15 });

    // Reclaiming is a click or a keystroke — never a Settings change.
    expect(terminalResize).not.toHaveBeenCalled();
    expect(seen).toEqual([{ cols: 60, rows: 20 }]);
    expect(terminalRemoteClaim("t-claimed")).toEqual({ cols: 60, rows: 20 });
  });

  it("marks only the first report as the attach announcement", () => {
    acquire("t-seedflag");
    const seeds: boolean[] = [];
    onTerminalGrid("t-seedflag", (_size, seed) => seeds.push(seed));
    emitResized("t-seedflag", 80, 24);
    emitResized("t-seedflag", 100, 30);
    expect(seeds).toEqual([true, false]);
  });
});

describe("output subscription", () => {
  it("keeps writing to a terminal whose pane is no longer mounted", () => {
    // The bug this guards: output only reached the terminal while a pane was
    // mounted, so hiding the panel (or switching reviews) dropped bytes and the
    // session came back drawing on top of a stale screen.
    const { term } = acquire("streaming");
    startTerminalOutput("streaming");
    const write = vi.spyOn(term, "write");

    emitOutput("streaming", "while hidden", 10);

    expect(write).toHaveBeenCalledTimes(1);
    expect(unsubOutput).not.toHaveBeenCalled();
  });

  it("holds output until the replay is flushed, then drops what it covered", () => {
    const { term } = acquire("replaying");
    const write = vi.spyOn(term, "write");

    // Arrives before the replay lands, so it waits.
    emitOutput("replaying", "early", 5);
    emitOutput("replaying", "late", 20);
    expect(write).not.toHaveBeenCalled();

    // The replay snapshot already ended at byte 10, so only the later chunk is
    // new; writing the earlier one too would double-render the overlap. The
    // scrollback goes first either way, or the screen is spliced out of order.
    const scrollback = new TextEncoder().encode("scrollback");
    startTerminalOutput("replaying", { data: scrollback, cursor: 10 });
    expect(
      write.mock.calls.map(([data]) =>
        typeof data === "string" ? data : new TextDecoder().decode(data),
      ),
    ).toEqual(["scrollback", "late"]);

    // Flushing is one-shot: a later mount finds nothing buffered.
    write.mockClear();
    startTerminalOutput("replaying");
    expect(write).not.toHaveBeenCalled();
  });

  it("detaches the output stream when the instance is disposed", () => {
    acquire("doomed");
    disposeTerminal(ids.pop()!);
    expect(unsubOutput).toHaveBeenCalledTimes(1);
    expect(outputListeners.has("doomed")).toBe(false);
  });
});

describe("acquireTerminal", () => {
  it("applies all font options to a new instance", () => {
    const { term } = acquire("a");
    expect(term.options.fontFamily).toBe("monospace");
    expect(term.options.fontSize).toBe(13);
    expect(term.options.fontWeight).toBe(400);
    expect(term.options.fontWeightBold).toBe(700);
    expect(term.options.lineHeight).toBe(1.0);
    expect(term.options.letterSpacing).toBe(0);
  });

  it("re-applies font options to an existing instance", () => {
    acquire("a");
    const { term, isNew } = acquireTerminal("a", {
      ...FONT_OPTS,
      fontFamily: "Menlo",
      fontWeight: 700,
      theme: buildXtermTheme(),
    });
    expect(isNew).toBe(false);
    expect(term.options.fontFamily).toBe("Menlo");
    expect(term.options.fontWeight).toBe(700);
  });
});

describe("refreshAllTerminalThemes", () => {
  it("applies the freshly-built theme to every live terminal", () => {
    const a = acquire("a");
    const b = acquire("b");

    document.documentElement.style.setProperty("--color-fg", "#123456");
    refreshAllTerminalThemes();

    const expected = buildXtermTheme();
    expect(a.term.options.theme).toEqual(expected);
    expect(b.term.options.theme).toEqual(expected);
    expect(a.term.options.theme?.foreground).toBe("#123456");
  });

  it("is a no-op when no terminals are live", () => {
    expect(() => refreshAllTerminalThemes()).not.toThrow();
  });
});

describe("refreshAllTerminalOptions", () => {
  it("applies fontSize as a raw px number — no rem conversion", () => {
    const { term } = acquire("c");

    refreshAllTerminalOptions({
      ...FONT_OPTS,
      fontFamily: "ui-monospace",
      fontSize: 16,
    });

    expect(term.options.fontSize).toBe(16);
    expect(typeof term.options.fontSize).toBe("number");
    expect(term.options.fontFamily).toBe("ui-monospace");
  });

  it("applies weight, line height, and letter spacing to every live terminal", () => {
    const a = acquire("a");
    const b = acquire("b");

    refreshAllTerminalOptions({
      fontFamily: "Menlo",
      fontSize: 20,
      fontWeight: 500,
      fontWeightBold: 700,
      lineHeight: 1.4,
      letterSpacing: 0.5,
    });

    for (const { term } of [a, b]) {
      expect(term.options.fontSize).toBe(20);
      expect(term.options.fontFamily).toBe("Menlo");
      expect(term.options.fontWeight).toBe(500);
      expect(term.options.lineHeight).toBe(1.4);
      expect(term.options.letterSpacing).toBe(0.5);
    }
  });

  it("skips fit()/resize for terminals with no rendered (zero-size) element", () => {
    const { term } = acquire("d");
    // Not opened into a container — term.element is undefined in jsdom, so
    // fit()/terminalResize must be skipped rather than throwing.
    expect(term.element).toBeUndefined();
    expect(() =>
      refreshAllTerminalOptions({ ...FONT_OPTS, fontSize: 14 }),
    ).not.toThrow();
    expect(term.options.fontSize).toBe(14);
  });
});

/**
 * A terminal as normalizeWheel sees it: a rendered element and a row count.
 * `reads` counts the element measurements — the layout flush the cache exists
 * to keep off a path that runs on every wheel event.
 */
function fakeTerm(
  pixelHeight: number,
  rows: number,
  screen: "normal" | "alternate" = "alternate",
) {
  let reads = 0;
  let height = pixelHeight;
  const term = {
    rows,
    buffer: { active: { type: screen } },
    element: {
      get clientHeight(): number {
        reads += 1;
        return height;
      },
    },
  };
  return {
    term: term as unknown as Terminal,
    reads: () => reads,
    setPixelHeight: (value: number) => {
      height = value;
    },
  };
}

/** One pixel notch: the lines it reported, or null if it was swallowed. */
function notch(term: Terminal, deltaY: number): number | null {
  const event = new WheelEvent("wheel", {
    deltaY,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
  });
  if (!normalizeWheel(term, event)) return null;
  expect(event.deltaMode).toBe(WheelEvent.DOM_DELTA_LINE);
  return event.deltaY;
}

describe("normalizeWheel", () => {
  it("reports a one-row notch as exactly one line", () => {
    // 400px over 10 rows: a 40px notch is one row of movement.
    const { term } = fakeTerm(400, 10);
    expect(notch(term, 40)).toBe(1);
    expect(notch(term, 40)).toBe(1);
  });

  it("carries sub-line movement until it adds up to whole lines", () => {
    const { term } = fakeTerm(400, 10);
    // Six 15px steps is 90px — two rows, with 10px left in the carry.
    const reported = [15, 15, 15, 15, 15, 15]
      .map((delta) => notch(term, delta))
      .filter((lines): lines is number => lines !== null);
    expect(reported).toEqual([1, 1]);
    // The remainder is not lost: 30px more crosses the third row.
    expect(notch(term, 30)).toBe(1);
  });

  it("measures the row height once, not once per event", () => {
    const { term, reads } = fakeTerm(400, 10);
    for (let i = 0; i < 20; i++) notch(term, 15);
    expect(reads()).toBe(1);
  });

  it("drops the carry when the gesture reverses direction", () => {
    const { term } = fakeTerm(400, 10);
    // 30px of downward residue must not eat the first upward notch.
    expect(notch(term, 30)).toBeNull();
    expect(notch(term, -40)).toBe(-1);
  });

  it("drops the carry with the row height it was measured under", () => {
    const { term, setPixelHeight } = fakeTerm(400, 10);
    // 35px accumulated under 40px rows...
    expect(notch(term, 35)).toBeNull();
    // ...then the font shrinks the rows to 10px. Without the reset those
    // 35 old-height pixels would burst out as several new-height lines.
    setPixelHeight(100);
    forgetCellHeight(term);
    expect(notch(term, 5)).toBeNull();
    expect(notch(term, 5)).toBe(1);
  });

  it("cancels swallowed sub-row events on the alternate screen only", () => {
    const swallowed = (screen: "normal" | "alternate") => {
      const { term } = fakeTerm(400, 10, screen);
      const event = new WheelEvent("wheel", {
        deltaY: 15,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        cancelable: true,
      });
      expect(normalizeWheel(term, event)).toBe(false);
      return event.defaultPrevented;
    };
    // A full-screen app's residue must not leak scrolling to the layout —
    // xterm would have cancelled here, and declining skipped that.
    expect(swallowed("alternate")).toBe(true);
    // The normal buffer scrolls natively; cancelling would freeze it.
    expect(swallowed("normal")).toBe(false);
  });

  it("leaves an event the browser already measured in lines alone", () => {
    const { term, reads } = fakeTerm(400, 10);
    const event = new WheelEvent("wheel", {
      deltaY: 3,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
    });
    expect(normalizeWheel(term, event)).toBe(true);
    expect(event.deltaY).toBe(3);
    expect(reads()).toBe(0);
  });
});

describe("attachRenderer", () => {
  it("does not throw when the GPU renderer is unavailable", () => {
    acquire("a");
    // The WebGL addon can't construct under jsdom; the failure is swallowed and
    // xterm keeps drawing with its built-in renderer.
    expect(() => attachRenderer("a")).not.toThrow();
    // Idempotent — every re-mount calls it again.
    expect(() => attachRenderer("a")).not.toThrow();
  });

  it("is a no-op for an unknown id", () => {
    expect(() => attachRenderer("missing")).not.toThrow();
    expect(hasTerminal("missing")).toBe(false);
  });
});
