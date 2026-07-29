import { describe, it, expect } from "vitest";
import { formatShortcut, toAccelerator, matchesEvent } from "./shortcuts";

/**
 * Which modifier stands in for `mod` here. The module resolves this once from
 * `navigator.platform`, so the tests ask rather than assume — they must pass
 * on a developer's Mac and on CI's Linux alike.
 */
const MOD_IS_META = matchesEvent(
  { code: "KeyA", mod: true },
  new KeyboardEvent("keydown", { code: "KeyA", metaKey: true }),
);

function event(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

/** An event carrying whichever modifier `mod` means on this platform. */
function withMod(init: KeyboardEventInit): KeyboardEvent {
  return event(
    MOD_IS_META ? { ...init, metaKey: true } : { ...init, ctrlKey: true },
  );
}

describe("toAccelerator", () => {
  it("renders the Tauri accelerator format", () => {
    expect(toAccelerator({ code: "KeyP", mod: true })).toBe("CmdOrCtrl+P");
    expect(toAccelerator({ code: "KeyF", mod: true, shift: true })).toBe(
      "CmdOrCtrl+Shift+F",
    );
    expect(toAccelerator({ code: "Backslash", mod: true, alt: true })).toBe(
      "CmdOrCtrl+Alt+\\",
    );
    expect(toAccelerator({ code: "Digit0", mod: true })).toBe("CmdOrCtrl+0");
    expect(toAccelerator({ code: "Comma", mod: true })).toBe("CmdOrCtrl+,");
    expect(toAccelerator({ code: "Equal", mod: true })).toBe("CmdOrCtrl+=");
    expect(toAccelerator({ code: "Minus", mod: true })).toBe("CmdOrCtrl+-");
  });

  it("renders an unmodified key", () => {
    expect(toAccelerator({ code: "KeyJ" })).toBe("J");
  });
});

describe("formatShortcut", () => {
  it("returns one token per key", () => {
    expect(formatShortcut({ code: "KeyP", mod: true })).toHaveLength(2);
    expect(
      formatShortcut({ code: "KeyF", mod: true, shift: true }),
    ).toHaveLength(3);
  });

  it("names the key last", () => {
    const parts = formatShortcut({ code: "KeyP", mod: true });
    expect(parts[parts.length - 1]).toBe("P");
  });

  it("uses arrow glyphs", () => {
    expect(formatShortcut({ code: "ArrowUp", mod: true })).toContain("↑");
  });
});

describe("matchesEvent", () => {
  it("matches a plain key", () => {
    expect(matchesEvent({ code: "KeyJ" }, event({ code: "KeyJ" }))).toBe(true);
    expect(matchesEvent({ code: "KeyJ" }, event({ code: "KeyK" }))).toBe(false);
  });

  it("requires the modifier to be present exactly", () => {
    const shortcut = { code: "KeyP", mod: true };
    expect(matchesEvent(shortcut, withMod({ code: "KeyP" }))).toBe(true);
    expect(matchesEvent(shortcut, event({ code: "KeyP" }))).toBe(false);
  });

  it("does not fire an unmodified binding when a modifier is held", () => {
    // "j" navigates hunks; ⌘J must not.
    expect(matchesEvent({ code: "KeyJ" }, withMod({ code: "KeyJ" }))).toBe(
      false,
    );
  });

  it("distinguishes the platform modifier from the other one", () => {
    const shortcut = { code: "KeyP", mod: true };
    const wrongModifier = event(
      MOD_IS_META
        ? { code: "KeyP", ctrlKey: true }
        : { code: "KeyP", metaKey: true },
    );
    expect(matchesEvent(shortcut, wrongModifier)).toBe(false);
  });

  it("requires shift to match exactly", () => {
    const plain = { code: "KeyF", mod: true };
    const shifted = { code: "KeyF", mod: true, shift: true };
    expect(matchesEvent(plain, withMod({ code: "KeyF", shiftKey: true }))).toBe(
      false,
    );
    expect(
      matchesEvent(shifted, withMod({ code: "KeyF", shiftKey: true })),
    ).toBe(true);
    expect(matchesEvent(shifted, withMod({ code: "KeyF" }))).toBe(false);
  });

  it("requires alt to match exactly", () => {
    const shortcut = { code: "Backslash", mod: true, alt: true };
    expect(
      matchesEvent(shortcut, withMod({ code: "Backslash", altKey: true })),
    ).toBe(true);
    expect(matchesEvent(shortcut, withMod({ code: "Backslash" }))).toBe(false);
  });

  // The reason bindings are described by `code` rather than `key`: on macOS,
  // Option+C reports `key === "ç"`, so the previous `key === "c"` test for the
  // case-sensitivity toggle could never fire.
  it("matches an Alt binding regardless of the character produced", () => {
    const shortcut = { code: "KeyC", alt: true };
    expect(
      matchesEvent(shortcut, event({ code: "KeyC", key: "ç", altKey: true })),
    ).toBe(true);
  });
});
