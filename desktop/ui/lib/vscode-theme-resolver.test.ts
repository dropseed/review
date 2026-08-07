import { describe, it, expect } from "vitest";
import {
  resolveVscodeTheme,
  type VscodeThemeDetection,
} from "./vscode-theme-resolver";

/** The sixteen keys VS Code themes use for the terminal palette. */
const ANSI_COLORS: Record<string, string> = {
  "terminal.ansiBlack": "#45475a",
  "terminal.ansiRed": "#f38ba8",
  "terminal.ansiGreen": "#a6e3a1",
  "terminal.ansiYellow": "#f9e2af",
  "terminal.ansiBlue": "#89b4fa",
  "terminal.ansiMagenta": "#f5c2e7",
  "terminal.ansiCyan": "#94e2d5",
  "terminal.ansiWhite": "#bac2de",
  "terminal.ansiBrightBlack": "#585b70",
  "terminal.ansiBrightRed": "#f37799",
  "terminal.ansiBrightGreen": "#89d88b",
  "terminal.ansiBrightYellow": "#ebd391",
  "terminal.ansiBrightBlue": "#74a8fc",
  "terminal.ansiBrightMagenta": "#f2aede",
  "terminal.ansiBrightCyan": "#6bd7ca",
  "terminal.ansiBrightWhite": "#a6adc8",
};

function detection(colors: Record<string, string>): VscodeThemeDetection {
  return {
    name: "Something Custom",
    themeType: "dark",
    colors: { "editor.background": "#1e1e2e", ...colors },
    // Empty so no Shiki theme is registered — this file is about the colors.
    tokenColors: [],
  };
}

describe("resolveVscodeTheme", () => {
  /**
   * Without this the terminal falls back to a generic ramp, so a Catppuccin
   * user gets Catppuccin chrome around Tomorrow Night output.
   */
  it("carries the theme's own terminal palette", () => {
    const theme = resolveVscodeTheme(detection(ANSI_COLORS));

    expect(theme.ansi).toEqual({
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
    });
  });

  it("leaves the palette unset for a theme that publishes no terminal colors", () => {
    expect(resolveVscodeTheme(detection({})).ansi).toBeUndefined();
  });

  /**
   * A partial ramp topped up from the shared fallback would pair one theme's
   * normals with another's brights — the mismatch this avoids, in miniature.
   */
  it("leaves the palette unset when the ramp is incomplete", () => {
    const partial = Object.fromEntries(
      Object.entries(ANSI_COLORS).filter(
        ([key]) => key !== "terminal.ansiBrightCyan",
      ),
    );

    expect(resolveVscodeTheme(detection(partial)).ansi).toBeUndefined();
  });
});
