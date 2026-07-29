import { describe, it, expect, afterEach } from "vitest";
import {
  encodeKittyKey,
  forgetKittyState,
  kittyFlags,
  registerKittyHandlers,
} from "./kitty-keys";

const DISAMBIGUATE = 1;

function key(
  init: Partial<KeyboardEventInit> & { key: string; code?: string },
  type: "keydown" | "keyup" = "keydown",
): KeyboardEvent {
  return new KeyboardEvent(type, { code: init.key, ...init });
}

/** A stand-in for xterm's parser that records the handlers it is given. */
function fakeTerm() {
  const handlers = new Map<
    string,
    (params: (number | number[])[]) => boolean
  >();
  const escHandlers = new Map<string, () => boolean>();
  return {
    handlers,
    escHandlers,
    parser: {
      registerCsiHandler(
        id: { prefix?: string; final: string },
        cb: (params: (number | number[])[]) => boolean,
      ) {
        const slot = `${id.prefix ?? ""}${id.final}`;
        handlers.set(slot, cb);
        return {
          dispose: () => {
            handlers.delete(slot);
          },
        };
      },
      registerEscHandler(id: { final: string }, cb: () => boolean) {
        escHandlers.set(id.final, cb);
        return {
          dispose: () => {
            escHandlers.delete(id.final);
          },
        };
      },
    },
  };
}

afterEach(() => {
  forgetKittyState("t");
});

describe("negotiation", () => {
  it("is off until a program asks for it", () => {
    expect(kittyFlags("t")).toBe(0);
  });

  it("pushes, pops, and reports the mode on query", () => {
    const term = fakeTerm();
    const replies: string[] = [];
    registerKittyHandlers(term, "t", (d) => replies.push(d));

    term.handlers.get(">u")!([DISAMBIGUATE]);
    expect(kittyFlags("t")).toBe(1);

    // A nested program pushes its own richer mode...
    term.handlers.get(">u")!([9]);
    expect(kittyFlags("t")).toBe(9);

    term.handlers.get("?u")!([]);
    expect(replies[replies.length - 1]).toBe("\x1b[?9u");

    // ...and popping restores what the parent had.
    term.handlers.get("<u")!([]);
    expect(kittyFlags("t")).toBe(1);
  });

  it("sets, adds and clears bits in place", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});

    term.handlers.get("=u")!([1, 1]); // set
    expect(kittyFlags("t")).toBe(1);
    term.handlers.get("=u")!([8, 2]); // or
    expect(kittyFlags("t")).toBe(9);
    term.handlers.get("=u")!([1, 3]); // not
    expect(kittyFlags("t")).toBe(8);
  });

  /** A garbled sequence must not silently change how every key is encoded. */
  it("ignores malformed requests rather than guessing", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});
    term.handlers.get(">u")!([1]);

    term.handlers.get("=u")!([2, 99]); // mode outside 1..3
    expect(kittyFlags("t")).toBe(1);
    term.handlers.get(">u")!([999]); // wider than five bits
    expect(kittyFlags("t")).toBe(1);
  });

  it("unwinds completely when a program pops past the bottom", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});
    term.handlers.get(">u")!([1]);
    term.handlers.get("<u")!([64]);
    expect(kittyFlags("t")).toBe(0);
  });

  it("clears the mode on a terminal reset, which is how a user recovers", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});
    term.handlers.get(">u")!([1]);
    expect(kittyFlags("t")).toBe(1);

    // ESC c, what `reset` sends.
    expect(term.escHandlers.get("c")!()).toBe(false); // xterm still resets
    expect(kittyFlags("t")).toBe(0);
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
