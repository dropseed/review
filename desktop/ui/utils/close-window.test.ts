import { vi, describe, it, expect, beforeEach } from "vitest";

// Hoisted: `vi.mock` runs before the module body, and the store this file
// imports reaches the platform on import.
const { confirm, close } = vi.hoisted(() => ({
  confirm: vi.fn<(message: string, title?: string) => Promise<boolean>>(),
  close: vi.fn<() => Promise<void>>(),
}));

vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    dialogs: { confirm },
    window: { close },
  }),
}));

import { closeWindowWithConfirmation, closeWindowPrompt } from "./close-window";
import { useReviewStore } from "../stores";

describe("closing the window", () => {
  beforeEach(() => {
    confirm.mockReset();
    close.mockReset();
    close.mockResolvedValue(undefined);
    useReviewStore.setState({ terminalSessions: {}, terminalExited: {} });
  });

  it("asks before closing", async () => {
    confirm.mockResolvedValue(true);
    expect(await closeWindowWithConfirmation()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("leaves the window alone when declined", async () => {
    confirm.mockResolvedValue(false);
    expect(await closeWindowWithConfirmation()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("only ever has one prompt open", async () => {
    // ⌘W leaned on: the presses behind the unanswered dialog must not stack
    // more of them.
    let answer: (ok: boolean) => void = () => {};
    confirm.mockReturnValue(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    );
    const first = closeWindowWithConfirmation();
    expect(await closeWindowWithConfirmation()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    answer(false);
    expect(await first).toBe(false);
  });

  it("names the terminals that outlive the window", () => {
    expect(closeWindowPrompt(0)).not.toMatch(/terminal/);
    expect(closeWindowPrompt(1)).toMatch(/1 terminal keeps running/);
    expect(closeWindowPrompt(3)).toMatch(/3 terminals keep running/);
  });

  it("counts only terminals still alive", async () => {
    confirm.mockResolvedValue(false);
    useReviewStore.setState({
      terminalSessions: {
        t1: { id: "t1" },
        t2: { id: "t2" },
      } as never,
      terminalExited: { t2: { exitCode: 0 } } as never,
    });
    await closeWindowWithConfirmation();
    expect(confirm.mock.calls[0][0]).toMatch(/1 terminal keeps running/);
  });
});
