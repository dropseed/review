import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const focusedTerminalId = vi.fn<() => string | null>(() => null);
const setTerminalFocus = vi.fn<(id: string, focused: boolean) => boolean>(
  () => true,
);

vi.mock("./close", () => ({ focusedTerminalId }));
vi.mock("./registry", () => ({ setTerminalFocus }));

const { installTerminalWindowFocus } = await import("./window-focus");

let uninstall: () => void;

beforeEach(() => {
  focusedTerminalId.mockReset().mockReturnValue(null);
  setTerminalFocus.mockReset().mockReturnValue(true);
  uninstall = installTerminalWindowFocus();
});

afterEach(() => uninstall());

const blurWindow = (): void => {
  window.dispatchEvent(new Event("blur"));
};
const focusWindow = (): void => {
  window.dispatchEvent(new Event("focus"));
};

describe("installTerminalWindowFocus", () => {
  it("blurs the focused terminal when the window loses OS focus", () => {
    focusedTerminalId.mockReturnValue("t1");
    blurWindow();
    expect(setTerminalFocus).toHaveBeenCalledWith("t1", false);
  });

  it("gives focus back on return", () => {
    focusedTerminalId.mockReturnValue("t1");
    blurWindow();
    focusWindow();
    expect(setTerminalFocus).toHaveBeenLastCalledWith("t1", true);
  });

  it("leaves focus alone when it was outside the terminal", () => {
    blurWindow();
    focusWindow();
    expect(setTerminalFocus).not.toHaveBeenCalled();
  });

  it("does not steal focus that moved while the window was away", () => {
    focusedTerminalId.mockReturnValue("t1");
    blurWindow();
    setTerminalFocus.mockClear();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    focusWindow();
    expect(setTerminalFocus).not.toHaveBeenCalled();
    input.remove();
  });

  it("forgets a session that was gone by the time we blurred it", () => {
    focusedTerminalId.mockReturnValue("t1");
    setTerminalFocus.mockReturnValue(false);
    blurWindow();
    setTerminalFocus.mockClear();
    focusWindow();
    expect(setTerminalFocus).not.toHaveBeenCalled();
  });

  it("restores only once per trip away", () => {
    focusedTerminalId.mockReturnValue("t1");
    blurWindow();
    focusWindow();
    setTerminalFocus.mockClear();
    focusWindow();
    expect(setTerminalFocus).not.toHaveBeenCalled();
  });

  it("stops listening once uninstalled", () => {
    uninstall();
    focusedTerminalId.mockReturnValue("t1");
    blurWindow();
    expect(setTerminalFocus).not.toHaveBeenCalled();
    uninstall = installTerminalWindowFocus();
  });
});
