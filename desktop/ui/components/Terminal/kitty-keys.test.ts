import { describe, it, expect, afterEach } from "vitest";
import { Terminal } from "@xterm/xterm";
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
  const bufferListeners: (() => void)[] = [];
  const buffer = {
    active: { type: "normal" as "normal" | "alternate" },
    onBufferChange(cb: () => void) {
      bufferListeners.push(cb);
      return { dispose: () => {} };
    },
  };
  return {
    handlers,
    escHandlers,
    buffer,
    /** What xterm does on `CSI ?1049h` / `l`: switch, then announce. */
    switchScreen(type: "normal" | "alternate") {
      buffer.active.type = type;
      bufferListeners.forEach((cb) => cb());
    },
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
  });

  // A push carrying bits we do not implement is a valid push, not a garbled
  // one — the protocol reserves room above the five bits here. Dropping it
  // while still honouring the program's later pop would unwind a level it
  // never pushed, taking the shell's mode with it.
  it("masks unknown flag bits instead of dropping the push", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});
    term.handlers.get(">u")!([1]);

    term.handlers.get(">u")!([999]); // wider than five bits
    expect(kittyFlags("t")).toBe(999 & 31);

    term.handlers.get("<u")!([1]);
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

describe("screen buffers", () => {
  /**
   * The bug this exists to prevent: a TUI enables the protocol on the alternate
   * screen and is killed before it can pop. With one shared stack the shell
   * inherits the mode and every keystroke encodes for a reader that is gone —
   * Ctrl+C arrives as `CSI 99;5u`, so the terminal cannot even be told `reset`.
   */
  it("does not let an alt-screen mode follow the shell home", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});

    term.switchScreen("alternate");
    term.handlers.get(">u")!([DISAMBIGUATE]);
    expect(kittyFlags("t")).toBe(1);

    // The TUI dies. Nothing pops; the shell simply gets its screen back.
    term.switchScreen("normal");
    expect(kittyFlags("t")).toBe(0);
  });

  it("keeps a program's mode while it visits the main screen", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});

    term.switchScreen("alternate");
    term.handlers.get(">u")!([9]);
    // Dropping out to run a child process and coming back is a normal thing
    // for a full-screen program to do.
    term.switchScreen("normal");
    term.switchScreen("alternate");
    expect(kittyFlags("t")).toBe(9);
  });

  it("keeps the shell's own mode across a program's visit", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});

    // A shell that negotiated the protocol for its own line editor.
    term.handlers.get(">u")!([DISAMBIGUATE]);
    term.switchScreen("alternate");
    term.handlers.get(">u")!([9]);
    term.switchScreen("normal");
    expect(kittyFlags("t")).toBe(1);
  });

  it("clears both screens on a terminal reset", () => {
    const term = fakeTerm();
    registerKittyHandlers(term, "t", () => {});
    term.handlers.get(">u")!([DISAMBIGUATE]);
    term.switchScreen("alternate");
    term.handlers.get(">u")!([9]);

    term.escHandlers.get("c")!();

    // A reset returns to the main screen, and finds nothing set there...
    expect(kittyFlags("t")).toBe(0);
    // ...nor waiting on the screen it just left.
    term.switchScreen("alternate");
    expect(kittyFlags("t")).toBe(0);
  });
});

/**
 * The fake above tests the logic; this tests the seam. Both fixes here read
 * state that xterm owns — `buffer.active.type` and `modes` — off events xterm
 * decides when to fire, and a fake that agrees with a wrong assumption about
 * either would pass while the terminal stayed broken.
 */
describe("against a real xterm", () => {
  const write = (term: Terminal, data: string) =>
    new Promise<void>((resolve) => term.write(data, resolve));

  it("tracks the screen buffer and DECCKM as xterm parses them", async () => {
    const term = new Terminal({ allowProposedApi: true });
    registerKittyHandlers(term, "real", () => {});

    // A TUI starts: alternate screen, protocol on, application cursor keys.
    await write(term, "\x1b[?1049h");
    expect(term.buffer.active.type).toBe("alternate");
    await write(term, "\x1b[>1u");
    expect(kittyFlags("real")).toBe(1);
    await write(term, "\x1b[?1h");
    expect(term.modes.applicationCursorKeysMode).toBe(true);
    expect(
      encodeKittyKey(key({ key: "ArrowUp" }), kittyFlags("real"), {
        applicationCursorKeys: term.modes.applicationCursorKeysMode,
      }),
    ).toBe("\x1bOA");

    // It exits without popping. The shell must get a clean keyboard back.
    await write(term, "\x1b[?1049l");
    expect(term.buffer.active.type).toBe("normal");
    expect(kittyFlags("real")).toBe(0);

    forgetKittyState("real");
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
