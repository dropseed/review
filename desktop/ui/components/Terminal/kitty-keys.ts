/**
 * The Kitty keyboard protocol, for terminals that ask for it.
 *
 * Legacy terminal key encoding is lossy: Enter, Ctrl+M and Ctrl+Enter all
 * arrive as `\r`, and Shift+Enter is indistinguishable from Enter. TUIs that
 * want those chords have historically needed the terminal to be configured with
 * a per-key hack — which is why Claude Code ships `/terminal-setup`, and why
 * this file replaces a hardcoded `Shift+Enter → ESC CR` special case.
 *
 * Under this protocol a program asks for unambiguous keys and every modified
 * key arrives as `CSI <key> ; <modifiers> u`. It is opt-in per program and
 * stack-based, so a TUI can enable it, a child process can push its own
 * setting, and popping restores whatever the parent had.
 *
 * **Only the encoder lives here.** The stack a program pushes and pops is
 * negotiated in the daemon (`core/src/terminal/kitty.rs`), which reads every
 * PTY byte for the session's whole life, and the flags in force ride along on
 * each session status as `kittyFlags` — which is what `setKittyFlags` records
 * below. That is the only place the answer can be right: a window that
 * re-derived the stack from replayed scrollback would miss a push that had
 * scrolled out of the ring, and two windows on one terminal would each hold
 * their own answer. The encoder stays here because it needs a DOM
 * `KeyboardEvent`.
 *
 * Scope: encoding implements `disambiguate` (1), `report_events` (2),
 * `report_all` (8) and `report_associated` (16). For `report_alternates` (4)
 * the shifted key is reported but the base-layout key is not — deriving it
 * needs `navigator.keyboard.getLayoutMap()`, which macOS WKWebView does not
 * implement, and a wrong base key is worse than none.
 *
 * Reference: the protocol as implemented by Ghostty (`src/input/key_encode.zig`,
 * `src/terminal/kitty/key.zig`). Independently written from that behaviour.
 */

// Bit 1 (`disambiguate`) is the baseline every other flag builds on, so any
// non-zero flag set means the protocol is active and there is nothing to test
// it against separately.
const FLAG_REPORT_EVENTS = 2;
const FLAG_REPORT_ALTERNATES = 4;
const FLAG_REPORT_ALL = 8;
const FLAG_REPORT_ASSOCIATED = 16;

/**
 * The mode the daemon last reported for each terminal, keyed the same way as
 * the terminal registry. Absent means the protocol is off, which is also what a
 * terminal this window has heard nothing about yet has to be treated as.
 */
const flagsById = new Map<string, number>();

/**
 * Record the mode carried on a session status (`TerminalStatus.kittyFlags`).
 *
 * Called for every status the store applies — the live stream and the one that
 * comes back with a cold reattach's replay — so a window that has just opened
 * on a long-running program encodes for the mode that program negotiated
 * however long ago.
 */
export function setKittyFlags(id: string, flags: number): void {
  if (flags > 0) flagsById.set(id, flags);
  else flagsById.delete(id);
}

/** The flags currently in force, 0 when the protocol is off. */
export function kittyFlags(id: string): number {
  return flagsById.get(id) ?? 0;
}

/** Drop a terminal's mode (tab closed, session killed). */
export function forgetKittyState(id: string): void {
  flagsById.delete(id);
}

// ---------------------------------------------------------------------------
// Key encoding
// ---------------------------------------------------------------------------

interface KeyEntry {
  /** The protocol's number for this key. */
  code: number;
  /** Terminating byte: `u` and `~` take the full form, letters the short one. */
  final: string;
  /** Modifier keys are silent unless the program asked for every key. */
  modifier?: boolean;
}

/**
 * Finals that DECCKM (`CSI ?1h`, application cursor keys) switches to SS3 —
 * the arrows plus Home and End. Function keys share the compact shape but not
 * this behaviour, so they are matched by final rather than by key name.
 */
const CURSOR_FINALS = new Set(["A", "B", "C", "D", "H", "F"]);

/** Keys addressed by `KeyboardEvent.key`. */
const BY_KEY: Record<string, KeyEntry> = {
  Escape: { code: 27, final: "u" },
  Enter: { code: 13, final: "u" },
  Tab: { code: 9, final: "u" },
  Backspace: { code: 127, final: "u" },
  Insert: { code: 2, final: "~" },
  Delete: { code: 3, final: "~" },
  ArrowLeft: { code: 1, final: "D" },
  ArrowRight: { code: 1, final: "C" },
  ArrowUp: { code: 1, final: "A" },
  ArrowDown: { code: 1, final: "B" },
  PageUp: { code: 5, final: "~" },
  PageDown: { code: 6, final: "~" },
  Home: { code: 1, final: "H" },
  End: { code: 1, final: "F" },
  F1: { code: 1, final: "P" },
  F2: { code: 1, final: "Q" },
  F3: { code: 13, final: "~" },
  F4: { code: 1, final: "S" },
  F5: { code: 15, final: "~" },
  F6: { code: 17, final: "~" },
  F7: { code: 18, final: "~" },
  F8: { code: 19, final: "~" },
  F9: { code: 20, final: "~" },
  F10: { code: 21, final: "~" },
  F11: { code: 23, final: "~" },
  F12: { code: 24, final: "~" },
  CapsLock: { code: 57358, final: "u", modifier: true },
  ScrollLock: { code: 57359, final: "u" },
  NumLock: { code: 57360, final: "u", modifier: true },
  PrintScreen: { code: 57361, final: "u" },
  Pause: { code: 57362, final: "u" },
};

/** Modifier keys, which differ by which side of the keyboard they are on. */
const MODIFIER_SIDES: Record<string, [number, number]> = {
  Shift: [57441, 57447],
  Control: [57442, 57448],
  Alt: [57443, 57449],
  Meta: [57444, 57450],
};

/** Keypad keys, addressed by `KeyboardEvent.code` since `key` is ambiguous. */
const BY_CODE: Record<string, number> = {
  Numpad0: 57399,
  Numpad1: 57400,
  Numpad2: 57401,
  Numpad3: 57402,
  Numpad4: 57403,
  Numpad5: 57404,
  Numpad6: 57405,
  Numpad7: 57406,
  Numpad8: 57407,
  Numpad9: 57408,
  NumpadDecimal: 57409,
  NumpadDivide: 57410,
  NumpadMultiply: 57411,
  NumpadSubtract: 57412,
  NumpadAdd: 57413,
  NumpadEnter: 57414,
  NumpadEqual: 57415,
  NumpadComma: 57416,
};

/**
 * The character a physical key produces with no modifiers, on a US layout.
 *
 * The protocol identifies keys by their unmodified codepoint, so Ctrl+Shift+A
 * and Ctrl+A both report `a` and are told apart by their modifier bits. The
 * browser only gives us the *modified* character, and the API that would give
 * us the real layout (`navigator.keyboard.getLayoutMap`) is not implemented in
 * macOS WKWebView — so this table is the fallback, with the event's own key as
 * a last resort for anything not on it.
 */
const US_LAYOUT: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: " ",
};

function unshiftedCodepoint(event: KeyboardEvent): number {
  const code = event.code;
  if (code.startsWith("Key") && code.length === 4) {
    return code.charCodeAt(3) + 32; // KeyA -> 'a'
  }
  if (code.startsWith("Digit") && code.length === 6) {
    return code.charCodeAt(5); // Digit1 -> '1'
  }
  const mapped = US_LAYOUT[code];
  if (mapped) return mapped.codePointAt(0) ?? 0;
  if (event.key.length === 1) {
    return event.key.toLowerCase().codePointAt(0) ?? 0;
  }
  return 0;
}

/** The text this keystroke produces, or "" if it is not a text key. */
function producedText(event: KeyboardEvent): string {
  return event.key.length === 1 ? event.key : "";
}

function modifierBits(event: KeyboardEvent, consumedShift: boolean): number {
  let bits = 0;
  if (event.shiftKey && !consumedShift) bits |= 1;
  if (event.altKey) bits |= 2;
  if (event.ctrlKey) bits |= 4;
  if (event.metaKey) bits |= 8;
  if (event.getModifierState?.("CapsLock")) bits |= 64;
  if (event.getModifierState?.("NumLock")) bits |= 128;
  return bits;
}

export interface EncodeOptions {
  /**
   * DECCKM, from `term.modes.applicationCursorKeysMode`. Only reaches the
   * unmodified cursor keys; a modified one is `CSI 1 ; mods A` either way.
   */
  applicationCursorKeys?: boolean;
}

/**
 * Encode a key event, or return `null` to let xterm.js handle it normally.
 *
 * An empty string means "swallow this key without sending anything" — which is
 * different from `null`, and is what bare modifier presses and unwanted release
 * events need.
 */
export function encodeKittyKey(
  event: KeyboardEvent,
  flags: number,
  opts: EncodeOptions = {},
): string | null {
  if (flags === 0) return null;

  const release = event.type === "keyup";
  const reportAll = (flags & FLAG_REPORT_ALL) !== 0;

  // Release events are silent unless asked for.
  if (release && (flags & FLAG_REPORT_EVENTS) === 0) return "";

  // Mid-composition keystrokes belong to the IME, not the program.
  if (event.isComposing || event.keyCode === 229) return null;

  const text = producedText(event);
  const unshifted = unshiftedCodepoint(event);
  // Ctrl, Alt and Meta stop a keystroke from producing text, so Shift is still
  // a modifier alongside them — that is what keeps Ctrl+Shift+A distinct from
  // Ctrl+A. Without one of those held, Shift is "used up" producing the
  // character itself and must not also be reported, or every capital letter
  // would arrive as a modified keypress instead of text.
  const suppressesText = event.ctrlKey || event.altKey || event.metaKey;
  const consumedShift =
    !suppressesText &&
    text !== "" &&
    unshifted !== 0 &&
    text !== String.fromCodePoint(unshifted);

  const mods = modifierBits(event, consumedShift);
  // Lock states don't count towards "is this an unmodified keystroke".
  const chordMods = mods & ~(64 | 128);

  const sided = MODIFIER_SIDES[event.key];
  const entry: KeyEntry | undefined = sided
    ? { code: sided[event.location === 2 ? 1 : 0], final: "u", modifier: true }
    : (BY_KEY[event.key] ??
      (BY_CODE[event.code] !== undefined
        ? { code: BY_CODE[event.code], final: "u" }
        : undefined));

  // An unmodified keystroke keeps its traditional encoding: Enter/Tab/Backspace
  // send the bytes the whole world sends, and ordinary typing passes through as
  // text. Without this every letter would become an escape sequence.
  if (!reportAll && chordMods === 0 && !release) {
    if (event.key === "Enter") return "\r";
    if (event.key === "Tab") return "\t";
    if (event.key === "Backspace") return "\x7f";
    if (text !== "" && !entry) return text;
  }

  const build = (target: KeyEntry): string =>
    buildSequence(target, {
      mods,
      event,
      flags,
      text,
      release,
      applicationCursorKeys: opts.applicationCursorKeys === true,
    });

  if (!entry) {
    // Not a key we have a number for: fall back to its codepoint, or hand it
    // back to xterm.js if we cannot name it at all.
    if (unshifted === 0) return text !== "" ? text : null;
    return build({ code: unshifted, final: "u" });
  }

  // Bare modifier presses are noise unless the program wants every key.
  if (entry.modifier && !reportAll) return "";

  return build(entry);
}

/** Everything about the keystroke except which key it was. */
interface SequenceContext {
  mods: number;
  event: KeyboardEvent;
  flags: number;
  text: string;
  release: boolean;
  applicationCursorKeys: boolean;
}

function buildSequence(
  entry: KeyEntry,
  { mods, event, flags, text, release, applicationCursorKeys }: SequenceContext,
): string {
  // The protocol encodes modifiers as a 1-based bitmask, so "no modifiers" is
  // 1 and is omitted entirely.
  const modValue = mods + 1;
  // Press is the default and is left implicit; only repeat and release are
  // spelled out, and only when the program asked for events.
  const eventType =
    (flags & FLAG_REPORT_EVENTS) !== 0
      ? release
        ? 3
        : event.repeat
          ? 2
          : 1
      : 1;
  const wantEvent = eventType !== 1;

  // Letters take a compact form that has no room for alternates or text.
  if (entry.final !== "u" && entry.final !== "~") {
    if (wantEvent) return `\x1b[1;${modValue}:${eventType}${entry.final}`;
    if (modValue > 1) return `\x1b[1;${modValue}${entry.final}`;
    // A program in application-cursor mode reads SS3, not CSI. Only the bare
    // form changes: once there are modifiers the CSI form is the only one that
    // can carry them, which is why DECCKM does not apply above.
    if (applicationCursorKeys && CURSOR_FINALS.has(entry.final)) {
      return `\x1bO${entry.final}`;
    }
    return `\x1b[${entry.final}`;
  }

  let key = String(entry.code);
  // The shifted character, when the program asked and shift actually produced
  // something different. Control keys never carry alternates.
  if (
    (flags & FLAG_REPORT_ALTERNATES) !== 0 &&
    event.shiftKey &&
    text !== "" &&
    entry.code >= 0x20 &&
    entry.code !== 0x7f
  ) {
    const shifted = text.codePointAt(0) ?? 0;
    if (shifted !== entry.code) key += `:${shifted}`;
  }

  let out = `\x1b[${key}`;
  if (wantEvent) out += `;${modValue}:${eventType}`;
  else if (modValue > 1) out += `;${modValue}`;

  // The text a keystroke produced, when asked for — but never when a modifier
  // that suppresses text is held, and never on release.
  if (
    (flags & FLAG_REPORT_ASSOCIATED) !== 0 &&
    !release &&
    text !== "" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    const cps = Array.from(text)
      .map((c) => c.codePointAt(0) ?? 0)
      .filter((cp) => cp >= 0x20 && cp !== 0x7f);
    if (cps.length > 0) {
      out += wantEvent || modValue > 1 ? ";" : ";;";
      out += cps.join(":");
    }
  }

  return out + entry.final;
}
