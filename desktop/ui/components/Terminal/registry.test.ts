import { describe, it, expect, afterEach, vi } from "vitest";
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
  }),
}));

/** Push a PTY output chunk at the registry, as the transport would. */
function emitOutput(id: string, text: string, seq: number): void {
  outputListeners.get(id)?.({ data: new TextEncoder().encode(text), seq });
}

// The WebGL addon needs a real GPU context that jsdom lacks, so instantiating
// it throws. That's fine for these tests: attachRenderer swallows construction
// failures. We assert the code path runs, not that a real addon attaches.
const {
  acquireTerminal,
  disposeTerminal,
  refreshAllTerminalOptions,
  refreshAllTerminalThemes,
  attachRenderer,
  startTerminalOutput,
  hasTerminal,
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
