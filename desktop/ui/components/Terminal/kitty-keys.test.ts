import { describe, it, expect, afterEach } from "vitest";
import { Terminal } from "@xterm/xterm";
import {
  encodeKittyKey,
  forgetKittyState,
  kittyFlags,
  setKittyFlags,
} from "./kitty-keys";

const DISAMBIGUATE = 1;

function key(
  init: Partial<KeyboardEventInit> & { key: string; code?: string },
  type: "keydown" | "keyup" = "keydown",
): KeyboardEvent {
  return new KeyboardEvent(type, { code: init.key, ...init });
}

afterEach(() => {
  forgetKittyState("t");
});

/**
 * The negotiation itself lives in the daemon (`core/src/terminal/kitty.rs`,
 * driven by the status scanner) — what a window does is remember the mode each
 * status reported and encode against it.
 */
describe("the mode the daemon reports", () => {
  it("is off until a status says otherwise", () => {
    expect(kittyFlags("t")).toBe(0);
  });

  it("is whatever the last status carried", () => {
    setKittyFlags("t", 1);
    expect(kittyFlags("t")).toBe(1);
    // A program pushed a richer mode, then popped back to the shell's.
    setKittyFlags("t", 9);
    expect(kittyFlags("t")).toBe(9);
    setKittyFlags("t", 0);
    expect(kittyFlags("t")).toBe(0);
  });

  it("keeps terminals apart, and forgets one with its session", () => {
    setKittyFlags("t", 1);
    setKittyFlags("other", 9);
    expect(kittyFlags("t")).toBe(1);

    forgetKittyState("other");
    expect(kittyFlags("other")).toBe(0);
    expect(kittyFlags("t")).toBe(1);
  });
});

/**
 * The one piece of terminal state the encoder still reads out of xterm: DECCKM,
 * off `term.modes`, which xterm owns and updates as it parses. A fake that
 * agreed with a wrong assumption about it would pass while arrow keys stayed
 * broken inside every pager.
 */
describe("against a real xterm", () => {
  const write = (term: Terminal, data: string) =>
    new Promise<void>((resolve) => term.write(data, resolve));

  it("tracks DECCKM as xterm parses it", async () => {
    const term = new Terminal({ allowProposedApi: true });
    // A TUI starts: alternate screen, protocol on (per the daemon), and
    // application cursor keys.
    setKittyFlags("t", 1);
    await write(term, "\x1b[?1049h\x1b[?1h");
    expect(term.modes.applicationCursorKeysMode).toBe(true);
    expect(
      encodeKittyKey(key({ key: "ArrowUp" }), kittyFlags("t"), {
        applicationCursorKeys: term.modes.applicationCursorKeysMode,
      }),
    ).toBe("\x1bOA");

    term.dispose();
  });
});

describe("encoding", () => {
  it("stays out of the way when no program has asked for it", () => {
    expect(encodeKittyKey(key({ key: "Enter", shiftKey: true }), 0)).toBeNull();
  });

  /**
   * The chords that motivated this. Each is indistinguishable from its
   * unmodified form under legacy encoding.
   */
  it("distinguishes the Enter and Tab chords", () => {
    const e = (init: Partial<KeyboardEventInit> & { key: string }) =>
      encodeKittyKey(key(init), DISAMBIGUATE);

    expect(e({ key: "Enter" })).toBe("\r");
    expect(e({ key: "Enter", shiftKey: true })).toBe("\x1b[13;2u");
    expect(e({ key: "Enter", altKey: true })).toBe("\x1b[13;3u");
    expect(e({ key: "Enter", ctrlKey: true })).toBe("\x1b[13;5u");
    expect(e({ key: "Enter", ctrlKey: true, shiftKey: true })).toBe(
      "\x1b[13;6u",
    );

    expect(e({ key: "Tab" })).toBe("\t");
    expect(e({ key: "Tab", shiftKey: true })).toBe("\x1b[9;2u");

    expect(e({ key: "Backspace" })).toBe("\x7f");
    expect(e({ key: "Backspace", shiftKey: true })).toBe("\x1b[127;2u");
  });

  /**
   * The failure mode to avoid: over-encoding. If ordinary typing became escape
   * sequences the terminal would be unusable, so text keys must pass through.
   */
  it("leaves ordinary typing as text", () => {
    expect(encodeKittyKey(key({ key: "a", code: "KeyA" }), DISAMBIGUATE)).toBe(
      "a",
    );
    // Shift is consumed producing the capital — it is not a modifier here.
    expect(
      encodeKittyKey(
        key({ key: "A", code: "KeyA", shiftKey: true }),
        DISAMBIGUATE,
      ),
    ).toBe("A");
    expect(
      encodeKittyKey(
        key({ key: "!", code: "Digit1", shiftKey: true }),
        DISAMBIGUATE,
      ),
    ).toBe("!");
  });

  it("encodes control chords against the unmodified key", () => {
    // Ctrl+A reports 'a' (97) with the ctrl bit, not the C0 byte.
    expect(
      encodeKittyKey(
        key({ key: "a", code: "KeyA", ctrlKey: true }),
        DISAMBIGUATE,
      ),
    ).toBe("\x1b[97;5u");
    // Ctrl+Shift+A keeps both bits and still reports the lowercase key.
    expect(
      encodeKittyKey(
        key({ key: "A", code: "KeyA", ctrlKey: true, shiftKey: true }),
        DISAMBIGUATE,
      ),
    ).toBe("\x1b[97;6u");
  });

  it("uses the compact form for cursor and function keys", () => {
    expect(encodeKittyKey(key({ key: "ArrowUp" }), DISAMBIGUATE)).toBe(
      "\x1b[A",
    );
    expect(
      encodeKittyKey(key({ key: "ArrowUp", ctrlKey: true }), DISAMBIGUATE),
    ).toBe("\x1b[1;5A");
    expect(encodeKittyKey(key({ key: "F1" }), DISAMBIGUATE)).toBe("\x1b[P");
    expect(encodeKittyKey(key({ key: "Delete" }), DISAMBIGUATE)).toBe(
      "\x1b[3~",
    );
  });

  /**
   * DECCKM. Every line editor and pager sets it, and a program that asked for
   * SS3 does not recognize CSI — arrow keys stop working inside it.
   */
  it("sends SS3 for cursor keys in application mode", () => {
    const app = { applicationCursorKeys: true };
    expect(encodeKittyKey(key({ key: "ArrowUp" }), DISAMBIGUATE, app)).toBe(
      "\x1bOA",
    );
    expect(encodeKittyKey(key({ key: "Home" }), DISAMBIGUATE, app)).toBe(
      "\x1bOH",
    );
    // Modifiers have nowhere to go in the SS3 form, so those stay CSI.
    expect(
      encodeKittyKey(key({ key: "ArrowUp", ctrlKey: true }), DISAMBIGUATE, app),
    ).toBe("\x1b[1;5A");
    // Function keys share the shape but not the mode.
    expect(encodeKittyKey(key({ key: "F1" }), DISAMBIGUATE, app)).toBe(
      "\x1b[P",
    );
  });

  it("swallows bare modifier presses unless every key was requested", () => {
    // Pressing Shift is itself a keydown with shiftKey already true.
    const shiftDown = key({ key: "Shift", shiftKey: true });
    expect(encodeKittyKey(shiftDown, DISAMBIGUATE)).toBe("");
    // flag 8 = report every key
    expect(encodeKittyKey(shiftDown, 9)).toBe("\x1b[57441;2u");
  });

  it("reports Enter, Tab and Backspace as keys when every key was requested", () => {
    expect(encodeKittyKey(key({ key: "Enter" }), 9)).toBe("\x1b[13u");
    expect(encodeKittyKey(key({ key: "Tab" }), 9)).toBe("\x1b[9u");
  });

  it("stays silent on release until a program asks for events", () => {
    expect(encodeKittyKey(key({ key: "a", code: "KeyA" }, "keyup"), 1)).toBe(
      "",
    );
    // flag 2 = report events; 3 = release
    expect(encodeKittyKey(key({ key: "Enter" }, "keyup"), 3)).toBe(
      "\x1b[13;1:3u",
    );
  });

  it("appends the produced text when asked, but not under text-suppressing modifiers", () => {
    // flag 16 = report associated text, on a key that also carries a modifier
    // that does not suppress text.
    expect(
      encodeKittyKey(
        key({ key: "a", code: "KeyA", ctrlKey: true }),
        DISAMBIGUATE | 16,
      ),
    ).toBe("\x1b[97;5u");
  });

  it("hands IME composition back to the terminal", () => {
    expect(
      encodeKittyKey(
        key({ key: "a", code: "KeyA", isComposing: true }),
        DISAMBIGUATE,
      ),
    ).toBeNull();
  });
});
