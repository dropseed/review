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
 * The stack is per screen buffer, which is the protocol's safety net rather
 * than a detail: a full-screen program does its work on the alternate screen,
 * so whatever it pushes there — and forgets to pop, or never gets the chance to
 * pop because it was killed — cannot follow the shell back to the main screen.
 *
 * Scope: negotiation is complete. Encoding implements `disambiguate` (1),
 * `report_events` (2), `report_all` (8) and `report_associated` (16). For
 * `report_alternates` (4) the shifted key is reported but the base-layout key
 * is not — deriving it needs `navigator.keyboard.getLayoutMap()`, which macOS
 * WKWebView does not implement, and a wrong base key is worse than none.
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

/** Flags are five bits; anything wider is a malformed request. */
const FLAGS_MAX = 31;

/**
 * How deep the mode stack goes before the oldest entry is dropped. Programs
 * push on entry and pop on exit; a leaked push must not be able to grow this
 * without bound, so it wraps rather than allocating.
 */
const STACK_DEPTH = 8;

/** Which buffer a terminal is showing. Each keeps its own mode stack. */
type ScreenBuffer = "normal" | "alternate";

interface KittyState {
  normal: number[];
  alternate: number[];
  screen: ScreenBuffer;
}

/** Per-terminal mode state, keyed the same way as the terminal registry. */
const states = new Map<string, KittyState>();

function stateFor(id: string): KittyState {
  let state = states.get(id);
  if (!state) {
    state = { normal: [0], alternate: [0], screen: "normal" };
    states.set(id, state);
  }
  return state;
}

function stackFor(id: string): number[] {
  const state = stateFor(id);
  return state[state.screen];
}

/** The flags currently in force, 0 when the protocol is off. */
export function kittyFlags(id: string): number {
  const stack = stackFor(id);
  return stack[stack.length - 1] ?? 0;
}

/** Drop a terminal's state (tab closed, session killed). */
export function forgetKittyState(id: string): void {
  states.delete(id);
}

/**
 * Follow the terminal onto the other screen buffer.
 *
 * The stacks do not merge and the one being left is not cleared: a program that
 * drops to the main screen to run a child and comes back expects to find its
 * own mode still in force. What it cannot do is impose that mode on the shell.
 */
function setScreen(id: string, screen: ScreenBuffer): void {
  stateFor(id).screen = screen;
}

/**
 * Reset to "off" on both screens. A full terminal reset (RIS) clears the mode,
 * otherwise a program that crashes mid-session leaves every later keystroke
 * encoded for a protocol nothing is reading.
 */
function resetKittyState(id: string): void {
  states.set(id, { normal: [0], alternate: [0], screen: "normal" });
}

/**
 * Zero both stacks without touching which screen is active — the screen keeps
 * tracking xterm's buffer, only the flags are declared dead.
 *
 * Called at a shell prompt (OSC 133;A). An interactive prompt means the shell
 * owns the terminal: no full-screen program is alive, so flags still set on
 * *either* screen were leaked by a program that died without popping. The
 * per-screen stacks stop such a leak reaching the shell, but the alternate
 * screen's copy would otherwise wait there for the next vim/less, which
 * inherits the dead program's mode as keys it cannot parse. Kitty's own shell
 * integration performs the same reset at each prompt.
 *
 * The accepted cost, same as kitty's: a TUI suspended with Ctrl+Z loses its
 * pushed mode when the prompt redraws, and `fg` resumes it un-enhanced until
 * it renegotiates.
 */
function clearLeakedFlags(id: string): void {
  const state = stateFor(id);
  state.normal = [0];
  state.alternate = [0];
}

function push(id: string, flags: number): void {
  const stack = stackFor(id);
  stack.push(flags);
  // Wrap rather than grow: drop the oldest entry once we exceed the depth.
  if (stack.length > STACK_DEPTH) stack.shift();
}

function pop(id: string, count: number): void {
  const state = stateFor(id);
  // A pop deeper than the stack is a program losing track of its own state;
  // treat it as "put everything back" rather than half-unwinding.
  if (count >= STACK_DEPTH) {
    state[state.screen] = [0];
    return;
  }
  const stack = state[state.screen];
  for (let i = 0; i < count; i++) {
    if (stack.length > 1) stack.pop();
    else stack[0] = 0;
  }
}

function set(id: string, flags: number, mode: number): void {
  const stack = stackFor(id);
  const top = stack.length - 1;
  const current = stack[top] ?? 0;
  // Modes outside 1..3 are malformed; leaving the state alone beats guessing,
  // since a garbled sequence would otherwise silently change key encoding.
  if (mode === 1) stack[top] = flags;
  else if (mode === 2) stack[top] = current | flags;
  else if (mode === 3) stack[top] = current & ~flags;
}

/** First param as a plain number, ignoring any subparameters. */
function param(params: (number | number[])[], index: number): number | null {
  const value = params[index];
  if (typeof value === "number") return value;
  if (Array.isArray(value) && typeof value[0] === "number") return value[0];
  return null;
}

/**
 * Wire up the four negotiation sequences on a terminal.
 *
 * `reply` sends the response to a query back to the PTY. Returns a disposer.
 */
export function registerKittyHandlers(
  term: {
    parser: {
      registerCsiHandler: (
        id: { prefix?: string; final: string },
        cb: (params: (number | number[])[]) => boolean,
      ) => { dispose: () => void };
      registerEscHandler: (
        id: { final: string },
        cb: () => boolean,
      ) => { dispose: () => void };
      registerOscHandler: (
        ident: number,
        cb: (data: string) => boolean,
      ) => { dispose: () => void };
    };
    buffer: {
      active: { type: ScreenBuffer };
      onBufferChange: (cb: () => void) => { dispose: () => void };
    };
  },
  id: string,
  reply: (data: string) => void,
): () => void {
  const handlers = [
    // Which stack is live follows the screen buffer. Watching xterm's own event
    // rather than parsing `CSI ?1049h` covers every way in — 47, 1047, 1049 and
    // a reset all arrive here as one signal.
    term.buffer.onBufferChange(() => {
      setScreen(id, term.buffer.active.type);
    }),
    // CSI ? u — what mode are we in?
    term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
      reply(`\x1b[?${kittyFlags(id)}u`);
      return true;
    }),
    // CSI > flags u — push. No parameter means "push 0", i.e. disable.
    term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
      const flags = params.length === 1 ? (param(params, 0) ?? 0) : 0;
      // Mask unknown bits rather than refusing the push. The protocol reserves
      // room above the five bits we implement, and dropping the push while
      // still honouring the program's later pop unwinds a level it never
      // pushed — taking the shell's mode with it. Ghostty masks for the same
      // reason.
      push(id, flags & FLAGS_MAX);
      return true;
    }),
    // CSI < n u — pop n levels, defaulting to one.
    term.parser.registerCsiHandler({ prefix: "<", final: "u" }, (params) => {
      pop(id, params.length === 1 ? (param(params, 0) ?? 1) : 1);
      return true;
    }),
    // CSI = flags ; mode u — set/or/clear in place.
    term.parser.registerCsiHandler({ prefix: "=", final: "u" }, (params) => {
      const flags = param(params, 0) ?? 0;
      const mode = params.length >= 2 ? (param(params, 1) ?? 1) : 1;
      if (flags <= FLAGS_MAX) set(id, flags, mode);
      return true;
    }),
    // ESC c — a full terminal reset. A program that enabled the protocol and
    // then died without popping would otherwise leave every later keystroke
    // encoded for a reader that is gone; `reset` is how a user fixes that.
    term.parser.registerEscHandler({ final: "c" }, () => {
      resetKittyState(id);
      // Not handled: xterm still needs to do the actual reset.
      return false;
    }),
    // OSC 133;A — the shell integration marking a prompt. The automatic
    // version of the `reset` above: see clearLeakedFlags.
    term.parser.registerOscHandler(133, (data) => {
      if (data === "A" || data.startsWith("A;")) clearLeakedFlags(id);
      // Not ours exclusively — the mark stays visible to any other consumer.
      return false;
    }),
  ];
  return () => handlers.forEach((h) => h.dispose());
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
