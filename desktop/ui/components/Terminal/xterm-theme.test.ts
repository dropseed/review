import { describe, it, expect, afterEach } from "vitest";
import { buildXtermTheme } from "./xterm-theme";
import { ansiPaletteFor } from "./terminal-palettes";
import { setActiveUiTheme } from "../../lib/active-theme";
import type { AnsiPalette, UiTheme, UiThemeTokens } from "../../lib/ui-themes";

/** A theme's own sixteen colors, the way a VS Code theme publishes them. */
const PUBLISHED_RAMP: AnsiPalette = {
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f37799",
  brightGreen: "#89d88b",
  brightYellow: "#ebd391",
  brightBlue: "#74a8fc",
  brightMagenta: "#f2aede",
  brightCyan: "#6bd7ca",
  brightWhite: "#a6adc8",
};

/** Set a CSS custom property on <html>, mirroring applyUiTheme's inline-style approach. */
function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

/**
 * A stand-in for an applied theme. The palette lookup reads only `id`,
 * `colorScheme` and `ansi`; the tokens reach the terminal as CSS variables,
 * which these tests set directly.
 */
function uiTheme(
  id: string,
  colorScheme: "light" | "dark",
  ansi?: AnsiPalette,
): UiTheme {
  return {
    id,
    label: id,
    colorScheme,
    preview: ["#000000", "#ffffff", "#ffffff"],
    codeTheme: "github-dark",
    tokens: {} as UiThemeTokens,
    ansi,
  };
}

/** Select a theme the way applyUiTheme does. */
function setTheme(
  id: string,
  scheme: "light" | "dark",
  ansi?: AnsiPalette,
): void {
  setActiveUiTheme(uiTheme(id, scheme, ansi));
  document.documentElement.style.setProperty("color-scheme", scheme);
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
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

  /**
   * A theme resolved from VS Code carries its own ramp. Substituting the
   * shared one there puts two themes in one window — the editor's chrome
   * around another theme's terminal output.
   */
  it("prefers a ramp the active theme carries over the shared fallback", () => {
    setTheme("vscode-something-custom", "dark", PUBLISHED_RAMP);

    const theme = buildXtermTheme();

    expect(theme.red).toBe("#f38ba8");
    expect(theme.brightRed).toBe("#f37799");
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
    const solarized = ansiPaletteFor(
      uiTheme("solarized-light", "light"),
      "light",
      "#eee8d5",
    );
    expect(solarized.white).not.toBe("#eee8d5");

    const flexoki = ansiPaletteFor(
      uiTheme("flexoki-light", "light"),
      "light",
      "#F2F0E5",
    );
    expect(flexoki.brightWhite).not.toBe("#F2F0E5");
  });

  it("leaves a palette alone when nothing collides", () => {
    const dark = ansiPaletteFor(uiTheme("dracula", "dark"), "dark", "#21222c");
    expect(dark.white).toBe("#f8f8f2");
    expect(dark.brightWhite).toBe("#ffffff");
  });

  it("uses the shared ramp when no theme has been applied yet", () => {
    expect(ansiPaletteFor(null, "dark", "#1c1917").red).toBe("#CC6666");
  });
});
