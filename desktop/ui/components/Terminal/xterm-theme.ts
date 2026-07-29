import type { ITheme } from "@xterm/xterm";
import { ansiPaletteFor } from "./terminal-palettes";

/**
 * Build an xterm theme from the app's CSS custom properties so the terminal
 * tracks the active UI theme. Call this fresh any time it's needed (theme
 * change, font change, initial mount) — it always reads the live values, so
 * callers just need to run it after the CSS vars it depends on are set.
 *
 * Background, foreground and selection come from the app's semantic tokens so
 * the terminal sits in the UI. The 16 ANSI colors do not: programs address
 * those by index and depend on normal and bright being distinguishable, which
 * six semantic tokens cannot express. Those come from each theme's own
 * published ramp — see `terminal-palettes.ts`.
 */
export function buildXtermTheme(): ITheme {
  const el = document.documentElement;
  const cs = getComputedStyle(el);
  const v = (name: string): string => cs.getPropertyValue(name).trim();

  const background = v("--color-surface-inset") || "#1c1917";
  const foreground = v("--color-fg") || "#fafaf9";
  // --color-selection exists on every bundled theme, but fall back to a
  // translucent foreground wash in case a custom/VS Code-derived theme omits it.
  const selectionBackground = v("--color-selection") || `${foreground}33`;

  const scheme =
    cs.getPropertyValue("color-scheme").trim() === "light" ? "light" : "dark";
  const ansi = ansiPaletteFor(el.dataset.uiTheme ?? "", scheme, background);

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground,
    ...ansi,
  };
}
