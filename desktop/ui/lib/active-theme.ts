/**
 * The UI theme currently applied to `<html>`.
 *
 * `applyUiTheme` writes the theme's colors out as CSS variables, which is all
 * the UI needs. The terminal needs the theme *object*: its 16-color ANSI ramp
 * is per-theme published data that no semantic token carries. A theme resolved
 * from VS Code is built on the fly from the editor's JSON and never enters
 * `getAllUiThemes()`, so an id alone is not enough to find it again.
 *
 * It lives in its own module so the terminal can read the active theme without
 * pulling in the whole theme catalog (and Shiki behind it).
 */

import type { UiTheme } from "./ui-themes";

let activeUiTheme: UiTheme | null = null;

export function setActiveUiTheme(theme: UiTheme): void {
  activeUiTheme = theme;
}

/** The applied theme, or null before the first `applyUiTheme` call. */
export function getActiveUiTheme(): UiTheme | null {
  return activeUiTheme;
}
