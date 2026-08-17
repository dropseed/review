import type { ITheme } from "@xterm/xterm";
import type { ISearchOptions } from "@xterm/addon-search";
import { ansiPaletteFor } from "./terminal-palettes";

/** One read of the live CSS tokens both builders below derive from. */
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string): string => cs.getPropertyValue(name).trim();
  const foreground = v("--color-fg") || "#fafaf9";
  return {
    v,
    foreground,
    // --color-selection exists on every bundled theme, but fall back to a
    // translucent foreground wash in case a custom/VS Code-derived theme
    // omits it.
    selection: v("--color-selection") || `${foreground}33`,
  };
}

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
  const { v, foreground, selection: selectionBackground } = readTokens();

  const background = v("--color-surface-inset") || "#1c1917";

  const scheme = v("color-scheme") === "light" ? "light" : "dark";
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

/**
 * Decoration colors for the ⌘F search addon, from the same live tokens as the
 * theme: matches wear the selection wash, the active match the "modified"
 * accent every theme carries. Read fresh per search-bar mount (like
 * buildXtermTheme per terminal mount) so a theme change recolors the next
 * search.
 */
export function buildSearchDecorations(): ISearchOptions["decorations"] {
  const { v, selection: match } = readTokens();
  const active = v("--color-status-modified") || "#fbbf24";

  return {
    matchBackground: match,
    matchOverviewRuler: match,
    activeMatchBackground: active,
    activeMatchColorOverviewRuler: active,
  };
}
