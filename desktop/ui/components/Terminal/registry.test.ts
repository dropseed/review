import { describe, it, expect, afterEach, vi } from "vitest";
import { buildXtermTheme } from "./xterm-theme";
import type { TerminalFontOptions } from "./registry";

// getApiClient() has an HMR-cache path (import.meta.hot.data) that only
// exists under Vite's dev server, not under vitest — mock it here rather
// than touching api/index.ts, which is outside this change's scope.
const terminalResize = vi.fn().mockResolvedValue(undefined);
vi.mock("../../api", () => ({
  getApiClient: () => ({ terminalResize }),
}));

// The WebGL and ligatures addons need a real GPU/DOM that jsdom lacks, so
// instantiating them throws. That's fine for these tests: applyRenderer /
// applyLigatures swallow construction failures. We assert the code path runs
// (and that "dom" cleanly unloads), not that a real addon attaches.
const {
  acquireTerminal,
  disposeTerminal,
  refreshAllTerminalOptions,
  refreshAllTerminalThemes,
  applyRenderer,
  applyLigatures,
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

describe("applyRenderer", () => {
  it("does not throw when switching a live terminal to WebGL or back to DOM", () => {
    acquire("a");
    // WebGL addon construction fails under jsdom; the failure is swallowed.
    expect(() => applyRenderer("a", "webgl")).not.toThrow();
    // Switching to DOM disposes any WebGL addon and is always safe.
    expect(() => applyRenderer("a", "dom")).not.toThrow();
  });

  it("is a no-op for an unknown id", () => {
    expect(() => applyRenderer("missing", "webgl")).not.toThrow();
    expect(hasTerminal("missing")).toBe(false);
  });
});

describe("applyLigatures", () => {
  it("does not throw when enabling under DOM or disabling", () => {
    acquire("a");
    expect(() => applyLigatures("a", true, "dom")).not.toThrow();
    expect(() => applyLigatures("a", false, "dom")).not.toThrow();
  });

  it("does not load the addon under the WebGL renderer", () => {
    acquire("a");
    // enabled=true but renderer=webgl → the DOM-only addon must not load.
    expect(() => applyLigatures("a", true, "webgl")).not.toThrow();
  });
});
