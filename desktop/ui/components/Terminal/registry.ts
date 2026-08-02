import { Terminal, type ITheme, type FontWeight } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import {
  Base64,
  ClipboardAddon,
  type ClipboardSelectionType,
  type IClipboardProvider,
} from "@xterm/addon-clipboard";
import { getApiClient } from "../../api";
// Imported from the leaf modules, not the `commands` barrel: the barrel also
// pulls `host`, which imports the assembled store — and `preferencesSlice`
// imports this file, so going through the barrel closes a cycle back onto the
// store's own construction. These two modules touch nothing but types.
import { IS_MAC, matchesEvent } from "../../commands/shortcuts";
import { getAllCommands } from "../../commands/registry";
import { getPlatformServices } from "../../platform";
import { buildXtermTheme } from "./xterm-theme";
import {
  encodeKittyKey,
  forgetKittyState,
  kittyFlags,
  registerKittyHandlers,
} from "./kitty-keys";

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
  /** Removes the kitty keyboard negotiation handlers. */
  disposeKitty: (() => void) | null;
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
    // xterm renders bold text in the bright variant of its color by default,
    // which silently rewrites the output of anything that color-codes by
    // severity — a bold red error arrives as bright red. Bold is a weight, not
    // a different color; native terminals stopped conflating the two.
    drawBoldTextInBrightColors: false,
    // Option sends ESC-prefixed sequences instead of composing characters —
    // the "Use Option as Meta key" setting every terminal-based CLI expects
    // (Option+Enter for a newline, Option+B/F for word motion, and Claude
    // Code's Option chords).
    macOptionIsMeta: true,
    scrollback: 10000,
    // Nerd Font powerline/icon glyphs are frequently drawn wider than the cell
    // they occupy. The WebGL renderer clips to the cell, so without rescaling
    // they arrive sheared; with it they are squeezed to fit.
    rescaleOverlappingGlyphs: true,
    // OSC 8 hyperlinks (a label with a hidden target) — CLIs use these for
    // login and docs links. Bare URLs in plain text are handled by the
    // web-links addon below.
    linkHandler: { activate: (_event, uri) => openTerminalLink(uri) },
  });
  term.attachCustomKeyEventHandler((event) => handleCustomKey(term, id, event));
  term.attachCustomWheelEventHandler((event) => normalizeWheel(term, event));
  // The grid changing shape is the other half of "a row is this tall" — the
  // pane was resized, or the font reflowed it.
  term.onResize(() => forgetCellHeight(term));
  // Lets a program negotiate the kitty keyboard protocol, so chords like
  // Ctrl+Enter and Shift+Tab arrive distinguishable instead of collapsing onto
  // the same bytes as their unmodified forms.
  const disposeKitty = registerKittyHandlers(term, id, (data) =>
    writeToPty(id, data),
  );
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_event, uri) => openTerminalLink(uri)));
  // xterm ships Unicode 6 width tables, where a modern emoji counts as one
  // column and a combining sequence counts as several. Coding agents draw
  // full-screen TUIs out of exactly those characters, so a width the program
  // and the terminal disagree on desynchronizes the cursor and every
  // subsequent redraw lands in the wrong column. This registers Unicode 15
  // plus grapheme clustering (what Ghostty/WezTerm/iTerm2 measure by) and
  // activates it on load — no activeVersion assignment needed.
  term.loadAddon(new UnicodeGraphemesAddon());
  // OSC 52: lets a program running in the terminal put text on the system
  // clipboard (Claude Code's `/copy`, tmux/vim yank). Write-only on purpose —
  // see ClipboardWriteOnlyProvider.
  term.loadAddon(new ClipboardAddon(new Base64(), new WriteOnlyClipboard()));
  const entry: RegistryEntry = {
    term,
    fit,
    webgl: null,
    unsubOutput: null,
    disposeKitty,
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
 * Send input to a session's PTY. Failure is logged rather than thrown: these
 * are keystrokes, and there is nothing useful a caller could do about one that
 * didn't land.
 */
function writeToPty(id: string, data: string): void {
  getApiClient()
    .terminalWrite(id, data)
    .catch((err) => console.error("[terminal] Write failed:", err));
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
/**
 * Whether this keystroke is one the app has bound, rather than the shell's.
 *
 * On macOS every ⌘ chord is the app's. Elsewhere ⌘ and Ctrl collapse onto one
 * key that the shell also uses heavily, so membership in the command registry
 * is the only honest test.
 */
function isAppChord(event: KeyboardEvent): boolean {
  if (IS_MAC) return event.metaKey;
  if (!event.ctrlKey) return false;
  return getAllCommands().some(
    (command) => command.shortcut && matchesEvent(command.shortcut, event),
  );
}

function handleCustomKey(
  term: Terminal,
  id: string,
  event: KeyboardEvent,
): boolean {
  const release = event.type === "keyup";
  if (!release && event.type !== "keydown") return true;

  // The platform's app-shortcut modifier (⌘ on macOS, Ctrl elsewhere) belongs
  // to the app — ⌘D split, ⌘` toggle, ⌘C/⌘V. On macOS the shell's Ctrl chords
  // (Ctrl+C, Ctrl+D, Ctrl+R) are a different key and pass straight through; on
  // Linux and Windows they are the same key, so only the chords the app has
  // actually claimed are withheld and everything else reaches the PTY.
  //
  // This applies to releases too. Skipping it there meant that with kitty
  // `report_events` on, the *release* of an app shortcut was encoded and
  // written to the PTY as a release with no matching press.
  if (isAppChord(event)) return false;

  // When a program has asked for the kitty keyboard protocol, every modified
  // key goes through it — that is the whole point of the program opting in.
  // A `null` means the protocol is off or the key isn't ours; an empty string
  // means it *is* ours and is deliberately silent (a bare modifier press).
  const encoded = encodeKittyKey(event, kittyFlags(id), {
    applicationCursorKeys: term.modes.applicationCursorKeysMode,
  });
  // Silence on release means "nothing to report", so let xterm see the event;
  // on press it means "consumed", so swallow it.
  if (encoded !== null && !(release && encoded === "")) {
    if (encoded !== "") writeToPty(id, encoded);
    // xterm does not preventDefault for us when a custom handler declines a
    // key, and the browser's own handling of Tab would move focus out of the
    // terminal entirely.
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  if (release) return true;

  // Shift+Enter inserts a newline instead of submitting. Without a key encoding
  // protocol the terminal would send a bare CR, indistinguishable from Enter;
  // ESC+CR is what CLIs read as "newline" and exactly what Claude Code's own
  // `/terminal-setup` configures for terminals in this position (Alacritty, VS
  // Code, Zed). Only reached when the program has not negotiated kitty mode,
  // which encodes this properly as CSI 13;2u.
  if (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    writeToPty(id, "\x1b\r");
    return false;
  }

  return true;
}

/** Wheel movement not yet worth a whole line, per terminal — see normalizeWheel. */
const wheelCarry = new WeakMap<Terminal, number>();

/** Measured cell height in CSS pixels, per terminal — see cellHeight. */
const wheelCellHeight = new WeakMap<Terminal, number>();

/**
 * How tall one row is, in CSS pixels.
 *
 * Cached because the only way to ask is to measure the element, and a wheel
 * arrives 60-120 times a second over a document a streaming terminal is
 * dirtying continuously — so every read would flush layout. Nothing changes the
 * answer except a resize or a font change, and both drop the entry.
 */
function cellHeight(term: Terminal): number {
  const cached = wheelCellHeight.get(term);
  if (cached !== undefined) return cached;
  const measured = (term.element?.clientHeight ?? 0) / term.rows;
  // A terminal that isn't rendered yet has nothing to measure; leave the cache
  // empty so the next event tries again rather than latching zero.
  if (measured) wheelCellHeight.set(term, measured);
  return measured;
}

/**
 * Drop the measurement, after anything that can change a row's height.
 * Exported for tests; production calls come from resize and font changes.
 */
export function forgetCellHeight(term: Terminal): void {
  wheelCellHeight.delete(term);
  // The carry is pixels measured against that row height; without the height
  // it was accumulated under, it would be divided by whatever comes next.
  wheelCarry.delete(term);
}

/**
 * Measure a wheel event in lines before xterm reads it.
 *
 * This handler is consulted only where the wheel is handed to the program —
 * mouse tracking, and the arrow-key fallback a full-screen TUI gets — never by
 * the scrollback viewport, which listens for itself. On those paths xterm
 * divides the pixel delta by the cell height and then keeps 30% of anything
 * under 50px, which leaves a mouse notch worth about a fifth of a line:
 * scrolling inside Claude Code or `less` crawls, while the same gesture over
 * scrollback moves several lines. (Those two constants are read out of
 * @xterm/xterm 6.0.0 — if a bump changes the damping, this handler is where to
 * look. `scrollSensitivity` is not the knob for it: it multiplies the delta
 * going into that path rather than replacing the path.)
 *
 * Converting here instead — cells of movement, at the size the cells actually
 * are — skips that damping, and the sub-line remainder is carried so a slow
 * scroll still arrives a line at a time rather than being rounded away.
 *
 * Exported for tests; the terminal itself gets this via
 * attachCustomWheelEventHandler.
 */
export function normalizeWheel(term: Terminal, event: WheelEvent): boolean {
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return true;
  const rowHeight = cellHeight(term);
  if (!rowHeight) return true;
  // A leftover carry only stays meaningful while the gesture keeps its
  // direction: added to a reversal it would eat the first notch of the new
  // direction instead of contributing to it.
  const prior = wheelCarry.get(term) ?? 0;
  const carried =
    prior === 0 || Math.sign(prior) === Math.sign(event.deltaY)
      ? prior + event.deltaY
      : event.deltaY;
  const lines = Math.trunc(carried / rowHeight);
  wheelCarry.set(term, carried - lines * rowHeight);
  // Nothing to report yet: the movement stays in the carry for the next
  // event. Declining skips xterm's whole wheel path — including the cancel it
  // applies on the no-scrollback (alternate screen) branch — so that cancel
  // is reproduced here, or every gesture's sub-row residue would leak its
  // default action to the surrounding layout. The normal buffer is the
  // opposite case: xterm leaves its events uncancelled so the viewport can
  // scroll natively, and so must this.
  if (lines === 0) {
    if (term.buffer.active.type === "alternate") {
      event.preventDefault();
      event.stopPropagation();
    }
    return false;
  }
  // deltaMode/deltaY are prototype accessors, so an own property shadows them
  // for the read xterm is about to make. Handing over line mode rather than a
  // scaled pixel delta is what takes it off the damped path.
  Object.defineProperty(event, "deltaMode", {
    value: WheelEvent.DOM_DELTA_LINE,
    configurable: true,
  });
  Object.defineProperty(event, "deltaY", { value: lines, configurable: true });
  return true;
}

function applyFontOptions(term: Terminal, opts: TerminalFontOptions): void {
  // Size, weight and line height all move the row height the wheel is measured
  // against, and none of them necessarily changes the row count.
  forgetCellHeight(term);
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
  entry.disposeKitty?.();
  entry.disposeKitty = null;
  // The keyboard mode belongs to the program that negotiated it, so it dies
  // with the session rather than leaking into whatever reuses this id.
  forgetKittyState(id);
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

/**
 * Move DOM focus into or out of a session's xterm. A session that has since
 * been disposed is simply gone, which is the answer we want at a restore.
 */
export function setTerminalFocus(id: string, focused: boolean): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  try {
    if (focused) entry.term.focus();
    else entry.term.blur();
  } catch {
    return false; // disposed mid-call
  }
  return true;
}
