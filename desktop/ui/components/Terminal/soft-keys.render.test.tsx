import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { sendKey } = vi.hoisted(() => ({ sendKey: vi.fn() }));
vi.mock("./registry", () => ({ sendKey }));

import { SoftKeys } from "./SoftKeys";
import { clearCtrl, isCtrlArmed } from "./soft-keys";

function show() {
  render(<SoftKeys terminalId="t1" />);
}

/** A key is pressed on pointer-down, so a held arrow repeats like a key. */
function press(label: string) {
  fireEvent.pointerDown(screen.getByLabelText(label));
}

afterEach(() => {
  cleanup();
  clearCtrl();
  vi.clearAllMocks();
});

describe("the phone's terminal keys", () => {
  /**
   * Named, never encoded here: what a key sends depends on what the program in
   * that session has negotiated (the kitty protocol, application cursor keys),
   * and the registry is what knows.
   */
  it("names the keys a software keyboard has none of", () => {
    show();

    press("esc");
    expect(sendKey).toHaveBeenCalledWith("t1", "Escape");

    press("Tab");
    expect(sendKey).toHaveBeenCalledWith("t1", "Tab");

    press("Shift-Tab");
    expect(sendKey).toHaveBeenCalledWith("t1", "Tab", { shift: true });

    // The bare keystroke, not the compose box's submit: an agent's menu is
    // walked with the arrows and taken with Enter.
    press("Enter");
    expect(sendKey).toHaveBeenCalledWith("t1", "Enter");
  });

  it("asks for arrows by direction", () => {
    show();

    press("↑");
    expect(sendKey).toHaveBeenCalledWith("t1", "up");
    press("→");
    expect(sendKey).toHaveBeenCalledWith("t1", "right");
  });

  it("arms Control rather than sending anything", () => {
    show();

    press("Control — applies to the next key you type");
    expect(sendKey).not.toHaveBeenCalled();
    expect(isCtrlArmed()).toBe(true);
    // Shown as held, since the person now has to know a modifier is waiting.
    expect(
      screen
        .getByLabelText("Control — applies to the next key you type")
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  /**
   * The keyboard must not drop out from under a bar that exists to be used
   * alongside it: on iOS, moving focus out of the terminal's textarea dismisses
   * it mid-sentence.
   */
  it("never takes focus off the terminal", () => {
    show();
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    screen.getByLabelText("esc").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
