/**
 * The 16 ANSI colors, per theme.
 *
 * These are separate from the app's semantic tokens on purpose. The UI needs a
 * handful of named colors; a terminal needs sixteen specific ones, because
 * programs address them by index and rely on normal and bright being visibly
 * different — that's how `ls`, `git`, and every TUI signal emphasis. Deriving
 * them from the UI palette produced a ramp where bright red and red were the
 * same color, which reads as a flat, washed-out terminal.
 *
 * Values are copied here rather than read from Ghostty's theme collection,
 * which is fetched at build time into the zig package cache and is not present
 * in a fresh checkout.
 *
 * Provenance is recorded per palette. Where Ghostty's vendored copy disagreed
 * with the theme's own upstream, the note says which one won and why.
 */

import { contrast, mixColors } from "../../lib/color";

export interface AnsiPalette {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** Tomorrow Night — Ghostty's own compiled-in default (`terminal/color.zig`). */
const TOMORROW_NIGHT: AnsiPalette = {
  black: "#1D1F21",
  red: "#CC6666",
  green: "#B5BD68",
  yellow: "#F0C674",
  blue: "#81A2BE",
  magenta: "#B294BB",
  cyan: "#8ABEB7",
  white: "#C5C8C6",
  brightBlack: "#666666",
  brightRed: "#D54E53",
  brightGreen: "#B9CA4A",
  brightYellow: "#E7C547",
  brightBlue: "#7AA6DA",
  brightMagenta: "#C397D8",
  brightCyan: "#70C0B1",
  brightWhite: "#EAEAEA",
};

/** GitHub Light Default — the light-background fallback ramp. */
const GITHUB_LIGHT: AnsiPalette = {
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#4d2d00",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#633c01",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

/** Solarized publishes one ramp for both modes; only fg/bg swap. */
const SOLARIZED: AnsiPalette = {
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#002b36",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};

const PALETTES: Record<string, AnsiPalette> = {
  "review-dark": TOMORROW_NIGHT,

  // Review's light theme is its own invention with no published ramp. The
  // Tomorrow family's light sibling is flat (its brights are byte-identical to
  // its normals), which is the exact problem this file exists to fix.
  "review-light": GITHUB_LIGHT,

  // GitHub Dark Default. Matches the `terminal.ansi*` keys in GitHub's own
  // VS Code theme. (Plain "GitHub Dark" is a different, flat palette.)
  "github-dark": {
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#ffffff",
  },

  // Dracula, matching the upstream Alacritty definition.
  dracula: {
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },

  // Tokyo Night, from upstream `folke/tokyonight.nvim`. Ghostty's vendored copy
  // predates the v3 bright ramp and is flat, so upstream wins here.
  "tokyo-night": {
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#ff899d",
    brightGreen: "#9fe044",
    brightYellow: "#faba4a",
    brightBlue: "#8db0ff",
    brightMagenta: "#c7a9ff",
    brightCyan: "#a4daff",
    brightWhite: "#c0caf5",
  },

  // Nord. Its spec deliberately reuses one color for normal and bright across
  // most slots — that flatness is the theme, not an omission. The exception is
  // brightBlack, where the specified nord3 is under 2:1 on our background;
  // Ghostty lightens it for legibility and we follow.
  nord: {
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#596377",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },

  "solarized-dark": SOLARIZED,
  "solarized-light": SOLARIZED,

  // Flexoki, from upstream's kitty config. Ghostty's vendored copy has the
  // ramps inverted — its "bright" is the darker 600 series — which makes
  // emphasized text recede instead of stand out.
  "flexoki-dark": {
    black: "#100F0F",
    red: "#AF3029",
    green: "#66800B",
    yellow: "#AD8301",
    blue: "#205EA6",
    magenta: "#A02F6F",
    cyan: "#24837B",
    white: "#878580",
    brightBlack: "#6F6E69",
    brightRed: "#D14D41",
    brightGreen: "#879A39",
    brightYellow: "#D0A215",
    brightBlue: "#4385BE",
    brightMagenta: "#CE5D97",
    brightCyan: "#3AA99F",
    brightWhite: "#CECDC3",
  },
  "flexoki-light": {
    black: "#100F0F",
    red: "#D14D41",
    green: "#879A39",
    yellow: "#D0A215",
    blue: "#4385BE",
    magenta: "#CE5D97",
    cyan: "#3AA99F",
    white: "#FFFCF0",
    brightBlack: "#6F6E69",
    brightRed: "#AF3029",
    brightGreen: "#66800B",
    brightYellow: "#AD8301",
    brightBlue: "#205EA6",
    brightMagenta: "#A02F6F",
    brightCyan: "#24837B",
    brightWhite: "#F2F0E5",
  },
};

/**
 * Nudge a color towards black until it is legible on `bg`.
 *
 * Bounded because the 10%-per-step mix has a fixed point above zero, so it
 * cannot reach black on its own and an unbounded loop would not terminate.
 */
function darkenUntilVisible(hex: string, bg: string, target: number): string {
  for (let i = 0; i < 24 && contrast(hex, bg) < target; i++) {
    hex = mixColors(hex, "#000000", 0.1);
  }
  return hex;
}

/**
 * The palette for a theme, or a shared ramp when the theme has no published
 * one (Review's own light theme, and anything derived from a VS Code theme).
 *
 * Light themes get one correction. Several put a paper white in slot 7 or 15
 * — Solarized's `base2` and Flexoki's `paper` are literally the background this
 * terminal draws on — so those slots would render invisible text. Ghostty
 * darkens them for the same reason. Only slots that actually collide are
 * touched, so a palette that is already fine is passed through untouched.
 */
export function ansiPaletteFor(
  themeId: string,
  colorScheme: "light" | "dark",
  background: string,
): AnsiPalette {
  const base =
    PALETTES[themeId] ??
    (colorScheme === "light" ? GITHUB_LIGHT : TOMORROW_NIGHT);
  if (colorScheme !== "light") return base;

  // 1.6:1 is well below a text-legibility threshold — the goal is only to stop
  // a color being *identical* to the background, not to restyle the theme.
  const MIN = 1.6;
  const fixed = { ...base };
  for (const slot of ["white", "brightWhite"] as const) {
    fixed[slot] = darkenUntilVisible(fixed[slot], background, MIN);
  }
  return fixed;
}
