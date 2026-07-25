import { Terminal, type ITheme, type FontWeight } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  Base64,
  ClipboardAddon,
  type ClipboardSelectionType,
  type IClipboardProvider,
} from "@xterm/addon-clipboard";
import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";
import { buildXtermTheme } from "./xterm-theme";

/**
 * Module-level registry of live xterm instances, keyed by terminal id. This is
 * what keeps a terminal alive across in-app tab switches: switching reviews
 * unmounts the pane (detaching the DOM) but leaves the Terminal instance here,
 * so re-mounting re-attaches the same buffer with no replay flicker. Instances
 * are only destroyed via disposeTerminal (on kill / tab close).
 *
 * The instance also owns its PTY output subscription, for the same reason it
 * owns the buffer: a hidden pane (panel closed, another review active) is still
 * a running program, and output that arrives while nothing is mounted has to
 * land in the buffer rather than be dropped. A pane that unsubscribed on
 * unmount would come back missing everything in between and keep drawing on top
 * of a stale screen — which reads as garbled output, not as a gap.
 */
interface RegistryEntry {
  term: Terminal;
  fit: FitAddon;
  webgl: WebglAddon | null;
  /** Detaches the output stream; called only from disposeTerminal. */
  unsubOutput: (() => void) | null;
  /**
   * Live output held back until a cold reattach's replay has been written, so
   * historical scrollback lands ahead of new bytes. `null` once flushed.
   */
  pending: { data: Uint8Array; seq: number }[] | null;
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
    // Option sends ESC-prefixed sequences instead of composing characters —
    // the "Use Option as Meta key" setting every terminal-based CLI expects
    // (Option+Enter for a newline, Option+B/F for word motion, and Claude
    // Code's Option chords).
    macOptionIsMeta: true,
    scrollback: 10000,
    // OSC 8 hyperlinks (a label with a hidden target) — CLIs use these for
    // login and docs links. Bare URLs in plain text are handled by the
    // web-links addon below.
    linkHandler: { activate: (_event, uri) => openTerminalLink(uri) },
  });
  term.attachCustomKeyEventHandler((event) => handleCustomKey(id, event));
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_event, uri) => openTerminalLink(uri)));
  // OSC 52: lets a program running in the terminal put text on the system
  // clipboard (Claude Code's `/copy`, tmux/vim yank). Write-only on purpose —
  // see ClipboardWriteOnlyProvider.
  term.loadAddon(new ClipboardAddon(new Base64(), new WriteOnlyClipboard()));
  const entry: RegistryEntry = {
    term,
    fit,
    webgl: null,
    unsubOutput: null,
    // A brand-new instance has nothing on screen yet, so hold output until the
    // caller has decided whether it needs a replay first.
    pending: [],
  };
  registry.set(id, entry);
  entry.unsubOutput = getApiClient().onTerminalOutput(id, ({ data, seq }) => {
    if (entry.pending) entry.pending.push({ data, seq });
    else safeWrite(entry, data);
  });
  return { term, fit, isNew: true };
}

/**
 * Open a link clicked in a terminal in the user's browser.
 *
 * Restricted to http(s): terminal output is untrusted input, and other schemes
 * (file:, and anything the OS has registered a handler for) can do far more
 * than open a page.
 */
function openTerminalLink(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  void getPlatformServices()
    .opener.openUrl(uri)
    .catch((err: unknown) =>
      console.error("[terminal] Failed to open link:", err),
    );
}

/**
 * OSC 52 clipboard access, writes only.
 *
 * Writing is the useful half (a program hands text to the clipboard). Reading
 * is the dangerous half: any program with a foothold on the terminal — an
 * `ssh` session, a `cat` of a hostile file — could ask for the clipboard's
 * contents and receive whatever the user last copied. No CLI needs that from
 * us, so reads return empty.
 */
class WriteOnlyClipboard implements IClipboardProvider {
  public readText(): string {
    return "";
  }

  public writeText(_selection: ClipboardSelectionType, text: string): void {
    void getPlatformServices()
      .clipboard.writeText(text)
      .catch((err: unknown) =>
        console.error("[terminal] Clipboard write failed:", err),
      );
  }
}

/**
 * Write to an instance, swallowing writes to a disposed one — a terminal can be
 * torn down while PTY output for it is still in flight.
 */
function safeWrite(entry: RegistryEntry, data: Uint8Array): void {
  try {
    entry.term.write(data);
  } catch {
    /* terminal disposed */
  }
}

/**
 * Start an instance streaming: write any replayed scrollback, then release the
 * output buffered while that replay was in flight.
 *
 * One call rather than two so the ordering is structural — scrollback has to
 * land before live output or the screen is spliced out of order. `cursor` is
 * the byte offset the replay ends at, so any chunk it already contains
 * (`seq <= cursor`) is dropped; the boundary always aligns to a chunk edge, so
 * no chunk straddles it. With no replay (a fresh session, or a replay that
 * failed) everything buffered is written. Idempotent: later mounts of the same
 * instance find nothing pending.
 */
export function startTerminalOutput(
  id: string,
  replay?: { data: Uint8Array; cursor: number },
): void {
  const entry = registry.get(id);
  if (!entry?.pending) return;
  if (replay) safeWrite(entry, replay.data);
  const cursor = replay?.cursor ?? -1;
  const pending = entry.pending;
  entry.pending = null;
  for (const chunk of pending) {
    if (chunk.seq > cursor) safeWrite(entry, chunk.data);
  }
}

/**
 * Keys xterm should NOT turn into PTY input.
 *
 * Returning false leaves the event alone (no preventDefault), so it keeps
 * bubbling to the app and the browser's own handling still runs — that's how
 * Cmd+C/Cmd+V stay native copy/paste.
 */
function handleCustomKey(id: string, event: KeyboardEvent): boolean {
  if (event.type !== "keydown") return true;

  // Cmd chords are app shortcuts (⌘D split, ⌘` toggle, ⌘C/⌘V) — macOS
  // terminals never forward them to the PTY. Ctrl chords are the shell's
  // (Ctrl+C, Ctrl+D, Ctrl+R) and must pass straight through.
  if (event.metaKey) return false;

  // Shift+Enter inserts a newline instead of submitting. xterm has no key
  // encoding protocol (kitty/modifyOtherKeys), so it would otherwise send a
  // bare CR; ESC+CR is the sequence CLIs read as "newline" and exactly what
  // Claude Code's own `/terminal-setup` configures for terminals in this
  // position (Alacritty, VS Code, Zed).
  if (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    getApiClient()
      .terminalWrite(id, "\x1b\r")
      .catch((err) => console.error("[terminal] Write failed:", err));
    return false;
  }

  return true;
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
 * Attach the GPU renderer to an instance. Must be called AFTER `term.open()` —
 * the addon needs a rendered element to bind its context to. Idempotent.
 *
 * xterm's built-in renderer rebuilds DOM text nodes every frame, which is the
 * wrong shape for what this terminal hosts: coding agents in full-screen mode
 * repaint the whole grid continuously. WebGL draws from a glyph atlas instead,
 * the same approach every native terminal takes.
 *
 * If the GPU context is lost (or WebGL is unavailable at all) the addon is
 * dropped and xterm falls back to its DOM renderer on its own — degraded, but
 * still drawing. That fallback is a safety net, not a second supported mode.
 */
export function attachRenderer(id: string): void {
  const entry = registry.get(id);
  if (!entry || entry.webgl) return;
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
    console.warn("[terminal] WebGL unavailable, falling back to DOM:", err);
  }
}

/** Destroy the xterm instance for `id` (kill / tab close). */
export function disposeTerminal(id: string): void {
  const entry = registry.get(id);
  if (!entry) return;
  entry.unsubOutput?.();
  entry.unsubOutput = null;
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
