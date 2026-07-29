import { describe, it, expect, afterEach } from "vitest";
import { buildXtermTheme } from "./xterm-theme";
import { ansiPaletteFor } from "./terminal-palettes";

/** Set a CSS custom property on <html>, mirroring applyUiTheme's inline-style approach. */
function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

/** Select a theme the way applyUiTheme does. */
function setTheme(id: string, scheme: "light" | "dark"): void {
  document.documentElement.dataset.uiTheme = id;
  document.documentElement.style.setProperty("color-scheme", scheme);
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.uiTheme;
});

describe("buildXtermTheme", () => {
  it("takes background, foreground and selection from the app's tokens", () => {
    setVar("--color-surface-inset", "#1c1917");
    setVar("--color-fg", "#fafaf9");
    setVar("--color-selection", "rgba(59, 130, 246, 0.3)");

    const theme = buildXtermTheme();

    expect(theme.background).toBe("#1c1917");
    expect(theme.foreground).toBe("#fafaf9");
    expect(theme.cursor).toBe("#fafaf9");
    expect(theme.cursorAccent).toBe("#1c1917");
    expect(theme.selectionBackground).toBe("rgba(59, 130, 246, 0.3)");
  });

  it("takes the 16 ANSI colors from the active theme's own palette", () => {
    setTheme("dracula", "dark");

    const theme = buildXtermTheme();

    // Dracula's published ramp, not anything derived from the UI tokens.
    expect(theme.red).toBe("#ff5555");
    expect(theme.brightRed).toBe("#ff6e6e");
    expect(theme.green).toBe("#50fa7b");
    expect(theme.brightGreen).toBe("#69ff94");
  });

  /**
   * The reason this file changed. Programs address the palette by index and
   * use bright as emphasis; when bright and normal are the same color, every
   * TUI that highlights with bright renders flat.
   */
  it("gives bright colors their own values instead of aliasing the normal ones", () => {
    for (const [id, scheme] of [
      ["review-dark", "dark"],
      ["dracula", "dark"],
      ["tokyo-night", "dark"],
      ["github-dark", "dark"],
      ["flexoki-dark", "dark"],
    ] as const) {
      setTheme(id, scheme);
      const theme = buildXtermTheme();
      const pairs = [
        [theme.red, theme.brightRed],
        [theme.green, theme.brightGreen],
        [theme.yellow, theme.brightYellow],
        [theme.blue, theme.brightBlue],
      ];
      for (const [normal, bright] of pairs) {
        expect(normal, `${id} should not alias bright onto normal`).not.toBe(
          bright,
        );
      }
    }
  });

  it("falls back to a shared ramp for a theme with no published palette", () => {
    setTheme("vscode-something-custom", "dark");
    const theme = buildXtermTheme();
    // Tomorrow Night, the dark fallback.
    expect(theme.red).toBe("#CC6666");

    setTheme("vscode-something-custom", "light");
    const light = buildXtermTheme();
    expect(light.red).toBe("#cf222e");
  });

  it("falls back to a translucent foreground wash when --color-selection is missing", () => {
    setVar("--color-fg", "#fafaf9");
    // --color-selection intentionally left unset.

    const theme = buildXtermTheme();

    expect(theme.selectionBackground).toBe("#fafaf933");
  });
});

describe("ansiPaletteFor", () => {
  /**
   * Solarized's `base2` and Flexoki's `paper` are the same colors those themes
   * use for the surface the terminal draws on, so slots 7 and 15 would be
   * invisible text. Only the colliding slots are corrected.
   */
  it("rescues light-theme whites that match the background", () => {
    const solarized = ansiPaletteFor("solarized-light", "light", "#eee8d5");
    expect(solarized.white).not.toBe("#eee8d5");

    const flexoki = ansiPaletteFor("flexoki-light", "light", "#F2F0E5");
    expect(flexoki.brightWhite).not.toBe("#F2F0E5");
  });

  it("leaves a palette alone when nothing collides", () => {
    const dark = ansiPaletteFor("dracula", "dark", "#21222c");
    expect(dark.white).toBe("#f8f8f2");
    expect(dark.brightWhite).toBe("#ffffff");
  });
});
