import type { ITheme } from "@xterm/xterm";

/**
 * Build an xterm theme from the app's CSS custom properties so the terminal
 * tracks the active UI theme. Call this fresh any time it's needed (theme
 * change, font change, initial mount) — it always reads the live values, so
 * callers just need to run it after the CSS vars it depends on are set.
 *
 * ANSI mapping: the app only defines a 6-color named palette (red/green/
 * yellow/blue/magenta/cyan) plus foreground/faint tokens, not a full 16-color
 * ANSI ramp. So:
 * - black -> --color-fg-faint (a dim, non-black foreground reads better than
 *   true black against our dark surfaces, and stays visible on light themes).
 * - white -> --color-fg (primary foreground).
 * - bright* variants map to the SAME six named colors as their normal
 *   counterparts (including brightBlack -> faint, brightWhite -> fg) — we
 *   don't maintain a separate bright ramp, matching the `.ansi-bright-*-fg`
 *   classes already defined in index.css.
 */
export function buildXtermTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string): string => cs.getPropertyValue(name).trim();

  const background = v("--color-surface-inset") || "#1c1917";
  const foreground = v("--color-fg") || "#fafaf9";
  const faint = v("--color-fg-faint") || "#918d89";
  // --color-selection exists on every bundled theme, but fall back to a
  // translucent foreground wash in case a custom/VS Code-derived theme omits it.
  const selectionBackground = v("--color-selection") || `${foreground}33`;

  const red = v("--color-red") || "#fb7185";
  const green = v("--color-green") || "#34d399";
  const yellow = v("--color-yellow") || "#fbbf24";
  const blue = v("--color-blue") || "#60a5fa";
  const magenta = v("--color-magenta") || "#c084fc";
  const cyan = v("--color-cyan") || "#22d3ee";

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground,
    black: faint,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white: foreground,
    brightBlack: faint,
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: foreground,
  };
}
