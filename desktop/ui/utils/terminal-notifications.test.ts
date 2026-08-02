import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TerminalPhase, TerminalStatus } from "../types";
import { terminalStatus } from "../test/fixtures";

const show = vi.fn(() => Promise.resolve());

vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    notifications: {
      show,
      isEnabled: () => Promise.resolve(true),
      requestPermission: () => Promise.resolve(true),
    },
  }),
}));

const { notifyTerminalAttention, setTerminalNotificationsEnabled } =
  await import("./terminal-notifications");

function status(
  phase: TerminalPhase,
  overrides: Partial<TerminalStatus> = {},
): TerminalStatus {
  return terminalStatus(phase, { enteredStateAt: 1, ...overrides });
}

/** Permission is resolved before sending, so a send lands a microtask late. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Every test runs as if the window were in the background. */
beforeEach(() => {
  show.mockClear();
  localStorage.clear();
  setTerminalNotificationsEnabled(true);
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
});

describe("notifyTerminalAttention", () => {
  it("notifies on the edge into needs_attention, with the message as the body", async () => {
    notifyTerminalAttention(
      status("working"),
      status("needs_attention", {
        title: "claude",
        attentionMessage: "Approve this edit?",
      }),
    );
    await flush();
    expect(show).toHaveBeenCalledWith("claude", "Approve this edit?");
  });

  it("falls back to the command and a generic body", async () => {
    notifyTerminalAttention(
      status("working"),
      status("needs_attention", { runningCommand: "codex" }),
    );
    await flush();
    expect(show).toHaveBeenCalledWith("codex", "Needs your attention");
  });

  it("stays quiet while the session sits in needs_attention", async () => {
    notifyTerminalAttention(
      status("needs_attention"),
      status("needs_attention", { runningCommand: "codex" }),
    );
    await flush();
    expect(show).not.toHaveBeenCalled();
  });

  it("notifies again when the attention message changes mid-spell", async () => {
    notifyTerminalAttention(
      status("working"),
      status("needs_attention", {
        title: "claude",
        attentionMessage: "Approve this edit?",
      }),
    );
    // Same spell, new question — a second interruption, not a republish.
    notifyTerminalAttention(
      status("needs_attention", { attentionMessage: "Approve this edit?" }),
      status("needs_attention", {
        title: "claude",
        attentionMessage: "Task finished",
      }),
    );
    // ...but a cwd/command republish carrying the same message stays quiet.
    notifyTerminalAttention(
      status("needs_attention", { attentionMessage: "Task finished" }),
      status("needs_attention", {
        title: "claude",
        attentionMessage: "Task finished",
        runningCommand: "claude",
      }),
    );
    await flush();
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith("claude", "Task finished");
  });

  it("stays quiet for a session that arrives already needing attention", async () => {
    notifyTerminalAttention(undefined, status("needs_attention"));
    await flush();
    expect(show).not.toHaveBeenCalled();
  });

  it("stays quiet when you are looking at the window", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    notifyTerminalAttention(status("working"), status("needs_attention"));
    await flush();
    expect(show).not.toHaveBeenCalled();
  });

  it("stays quiet when the preference is off", async () => {
    setTerminalNotificationsEnabled(false);
    notifyTerminalAttention(status("working"), status("needs_attention"));
    await flush();
    expect(show).not.toHaveBeenCalled();
  });

  it("sends one notification per spell across windows sharing storage", async () => {
    const prev = status("working");
    const next = status("needs_attention");
    notifyTerminalAttention(prev, next);
    notifyTerminalAttention(prev, next);
    await flush();
    expect(show).toHaveBeenCalledTimes(1);

    // A later spell in the same session is a new thing to be told about.
    notifyTerminalAttention(
      prev,
      status("needs_attention", {
        enteredStateAt: 2,
      }),
    );
    await flush();
    expect(show).toHaveBeenCalledTimes(2);
  });
});
