import { Terminal, type ITheme, type FontWeight } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { getApiClient } from "../../api";
import { buildXtermTheme } from "./xterm-theme";

export type TerminalRenderer = "dom" | "webgl";

/**
 * Module-level registry of live xterm instances, keyed by terminal id. This is
 * what keeps a terminal alive across in-app tab switches: switching reviews
 * unmounts the pane (detaching the DOM) but leaves the Terminal instance here,
 * so re-mounting re-attaches the same buffer with no replay flicker. Instances
 * are only destroyed via disposeTerminal (on kill / tab close).
 */
interface RegistryEntry {
  term: Terminal;
  fit: FitAddon;
  webgl: WebglAddon | null;
  ligatures: LigaturesAddon | null;
}

const registry = new Map<string, RegistryEntry>();

/** Font/spacing values applied to every live term (see refreshAllTerminalOptions). */
export interface TerminalFontOptions {
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeight;
  fontWeightBold: FontWeight;
  lineHeight: number;
  letterSpacing: number;
}

export interface AcquireOptions extends TerminalFontOptions {
  theme: ITheme;
}

export interface AcquireResult {
  term: Terminal;
  fit: FitAddon;
  /** True when the instance was created by this call (needs content/replay). */
  isNew: boolean;
}

/**
 * Get the existing xterm instance for `id`, or create one. Font and theme are
 * (re)applied every call so preference changes take effect on the next mount.
 */
export function acquireTerminal(
  id: string,
  opts: AcquireOptions,
): AcquireResult {
  const existing = registry.get(id);
  if (existing) {
    applyFontOptions(existing.term, opts);
    existing.term.options.theme = opts.theme;
    return { term: existing.term, fit: existing.fit, isNew: false };
  }

  const term = new Terminal({
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize,
    fontWeight: opts.fontWeight,
    fontWeightBold: opts.fontWeightBold,
    lineHeight: opts.lineHeight,
    letterSpacing: opts.letterSpacing,
    theme: opts.theme,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 10000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  registry.set(id, { term, fit, webgl: null, ligatures: null });
  return { term, fit, isNew: true };
}

function applyFontOptions(term: Terminal, opts: TerminalFontOptions): void {
  term.options.fontFamily = opts.fontFamily;
  term.options.fontSize = opts.fontSize;
  term.options.fontWeight = opts.fontWeight;
  term.options.fontWeightBold = opts.fontWeightBold;
  term.options.lineHeight = opts.lineHeight;
  term.options.letterSpacing = opts.letterSpacing;
}

/**
 * Select the renderer for a single instance, switching live. "webgl" loads the
 * WebGL addon (with the context-loss fallback to DOM); "dom" disposes any
 * loaded WebGL addon so xterm falls back to its default DOM renderer, which
 * uses native macOS font smoothing and reads crisper. Must be called AFTER
 * `term.open()` — the WebGL addon needs a rendered element. Idempotent.
 */
export function applyRenderer(id: string, renderer: TerminalRenderer): void {
  const entry = registry.get(id);
  if (!entry) return;
  if (renderer === "webgl") {
    if (entry.webgl) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        try {
          addon.dispose();
        } catch {
          // ignore — disposing a lost-context addon can throw
        }
        const e = registry.get(id);
        if (e) e.webgl = null;
      });
      entry.term.loadAddon(addon);
      entry.webgl = addon;
    } catch (err) {
      console.warn("[terminal] WebGL renderer unavailable, using DOM:", err);
    }
  } else if (entry.webgl) {
    try {
      entry.webgl.dispose();
    } catch {
      // ignore
    }
    entry.webgl = null;
  }
}

/** Apply the renderer choice to every live terminal (used by the setter). */
export function applyRendererToAll(renderer: TerminalRenderer): void {
  for (const id of registry.keys()) applyRenderer(id, renderer);
}

/**
 * Load or unload the ligatures addon for a single instance. Ligatures only
 * work with the DOM renderer, so they're loaded only when `enabled` AND
 * `renderer === "dom"`; any other combination unloads. Guarded because a font
 * without ligature tables can make the addon throw. Idempotent.
 */
export function applyLigatures(
  id: string,
  enabled: boolean,
  renderer: TerminalRenderer,
): void {
  const entry = registry.get(id);
  if (!entry) return;
  const shouldLoad = enabled && renderer === "dom";
  if (shouldLoad) {
    if (entry.ligatures) return;
    try {
      const addon = new LigaturesAddon();
      entry.term.loadAddon(addon);
      entry.ligatures = addon;
    } catch (err) {
      console.warn("[terminal] Ligatures unavailable:", err);
    }
  } else if (entry.ligatures) {
    try {
      entry.ligatures.dispose();
    } catch {
      // ignore
    }
    entry.ligatures = null;
  }
}

/** Apply the ligatures choice to every live terminal (used by the setter). */
export function applyLigaturesToAll(
  enabled: boolean,
  renderer: TerminalRenderer,
): void {
  for (const id of registry.keys()) applyLigatures(id, enabled, renderer);
}

/** Destroy the xterm instance for `id` (kill / tab close). */
export function disposeTerminal(id: string): void {
  const entry = registry.get(id);
  if (!entry) return;
  try {
    entry.ligatures?.dispose();
  } catch {
    // ignore
  }
  try {
    entry.webgl?.dispose();
  } catch {
    // ignore
  }
  try {
    entry.term.dispose();
  } catch {
    // ignore
  }
  registry.delete(id);
}

/**
 * Re-theme every live terminal in place. Call this AFTER the CSS custom
 * properties it reads (via buildXtermTheme) have been updated — e.g. right
 * after `applyUiTheme()` — since it rebuilds the theme from their current
 * computed values.
 */
export function refreshAllTerminalThemes(): void {
  const theme = buildXtermTheme();
  for (const entry of registry.values()) {
    entry.term.options.theme = theme;
  }
}

/**
 * Push font/spacing options to every live terminal, then reflow: `fit()`
 * recomputes cols/rows for the new glyph metrics, and `terminalResize()` tells
 * the PTY so the running program sees the new size. Panes hidden behind an
 * inactive tab have a zero-size container — `fit()` is skipped for those, since
 * it would compute a bogus 0-size grid; they refit automatically via
 * TerminalPane's ResizeObserver when their container regains size on
 * activation.
 */
export function refreshAllTerminalOptions(opts: TerminalFontOptions): void {
  const client = getApiClient();
  for (const [id, entry] of registry) {
    applyFontOptions(entry.term, opts);

    const el = entry.term.element;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) continue;
    try {
      entry.fit.fit();
    } catch {
      continue;
    }
    client
      .terminalResize(id, entry.term.cols, entry.term.rows)
      .catch((err) => console.error("[terminal] Resize failed:", err));
  }
}

/** Whether an instance already exists (test/debug helper). */
export function hasTerminal(id: string): boolean {
  return registry.has(id);
}
