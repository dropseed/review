import { describe, it, expect, afterEach } from "vitest";
import { buildXtermTheme } from "./xterm-theme";

/** Set a CSS custom property on <html>, mirroring applyUiTheme's inline-style approach. */
function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("buildXtermTheme", () => {
  it("maps CSS custom properties onto the xterm ITheme fields", () => {
    setVar("--color-surface-inset", "#1c1917");
    setVar("--color-fg", "#fafaf9");
    setVar("--color-fg-faint", "#918d89");
    setVar("--color-selection", "rgba(59, 130, 246, 0.3)");
    setVar("--color-red", "#fb7185");
    setVar("--color-green", "#34d399");
    setVar("--color-yellow", "#fbbf24");
    setVar("--color-blue", "#60a5fa");
    setVar("--color-magenta", "#c084fc");
    setVar("--color-cyan", "#22d3ee");

    const theme = buildXtermTheme();

    expect(theme.background).toBe("#1c1917");
    expect(theme.foreground).toBe("#fafaf9");
    expect(theme.cursor).toBe("#fafaf9");
    expect(theme.cursorAccent).toBe("#1c1917");
    expect(theme.selectionBackground).toBe("rgba(59, 130, 246, 0.3)");
    expect(theme.black).toBe("#918d89");
    expect(theme.white).toBe("#fafaf9");
    expect(theme.red).toBe("#fb7185");
    expect(theme.green).toBe("#34d399");
    expect(theme.yellow).toBe("#fbbf24");
    expect(theme.blue).toBe("#60a5fa");
    expect(theme.magenta).toBe("#c084fc");
    expect(theme.cyan).toBe("#22d3ee");
  });

  it("maps every bright* color to the same value as its non-bright counterpart", () => {
    setVar("--color-fg", "#fafaf9");
    setVar("--color-fg-faint", "#918d89");
    setVar("--color-red", "#fb7185");
    setVar("--color-green", "#34d399");
    setVar("--color-yellow", "#fbbf24");
    setVar("--color-blue", "#60a5fa");
    setVar("--color-magenta", "#c084fc");
    setVar("--color-cyan", "#22d3ee");

    const theme = buildXtermTheme();

    expect(theme.brightBlack).toBe(theme.black);
    expect(theme.brightRed).toBe(theme.red);
    expect(theme.brightGreen).toBe(theme.green);
    expect(theme.brightYellow).toBe(theme.yellow);
    expect(theme.brightBlue).toBe(theme.blue);
    expect(theme.brightMagenta).toBe(theme.magenta);
    expect(theme.brightCyan).toBe(theme.cyan);
    expect(theme.brightWhite).toBe(theme.white);
  });

  it("falls back to hardcoded defaults when CSS vars are unset", () => {
    // No vars set — jsdom's getComputedStyle returns "" for unknown custom properties.
    const theme = buildXtermTheme();

    expect(theme.background).toBe("#1c1917");
    expect(theme.foreground).toBe("#fafaf9");
    expect(theme.black).toBe("#918d89");
    expect(theme.red).toBe("#fb7185");
  });

  it("falls back to a translucent foreground wash when --color-selection is missing", () => {
    setVar("--color-fg", "#fafaf9");
    // --color-selection intentionally left unset.

    const theme = buildXtermTheme();

    expect(theme.selectionBackground).toBe("#fafaf933");
  });
});
