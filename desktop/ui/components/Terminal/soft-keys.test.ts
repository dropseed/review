import { describe, it, expect, afterEach } from "vitest";
import {
  applyArmedModifiers,
  clearCtrl,
  ctrlCode,
  isCtrlArmed,
  subscribeSoftKeys,
  toggleCtrl,
} from "./soft-keys";

afterEach(() => clearCtrl());

describe("the key bar's Control", () => {
  it("passes a keystroke through untouched when nothing is armed", () => {
    expect(applyArmedModifiers("c")).toBe("c");
  });

  it("turns the next character into its control code, once", () => {
    toggleCtrl();
    // ⌃C, typed as a tap and then a letter on the system keyboard.
    expect(applyArmedModifiers("c")).toBe("\x03");
    expect(isCtrlArmed()).toBe(false);
    // The one after it is an ordinary letter again — a modifier that stayed on
    // would be a mode with nothing on a phone to show its state.
    expect(applyArmedModifiers("c")).toBe("c");
  });

  it("is a toggle, so an armed modifier can be put back", () => {
    toggleCtrl();
    toggleCtrl();
    expect(applyArmedModifiers("c")).toBe("c");
  });

  it("keeps the modifier for a keystroke it cannot modify", () => {
    toggleCtrl();
    // An escape a key already sends, or a paste: neither is "Ctrl and a key",
    // and consuming the tap on one would lose the modifier the person is
    // still waiting to use.
    expect(applyArmedModifiers("\x1b[A")).toBe("\x1b[A");
    expect(isCtrlArmed()).toBe(true);
    expect(applyArmedModifiers("d")).toBe("\x04");
  });

  it("spends the tap on a character with no control code", () => {
    toggleCtrl();
    expect(applyArmedModifiers("é")).toBe("é");
    expect(isCtrlArmed()).toBe(false);
  });

  it("tells the bar when the armed state changes", () => {
    let notified = 0;
    const unsubscribe = subscribeSoftKeys(() => (notified += 1));
    toggleCtrl();
    applyArmedModifiers("c");
    unsubscribe();
    toggleCtrl();
    expect(notified).toBe(2);
  });

  it("knows the codes the symbol row sends", () => {
    expect(ctrlCode("[")).toBe("\x1b");
    expect(ctrlCode(" ")).toBe("\x00");
    expect(ctrlCode("A")).toBe("\x01");
    expect(ctrlCode("5")).toBeNull();
  });
});
