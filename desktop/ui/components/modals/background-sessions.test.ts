import { describe, it, expect } from "vitest";
import { toBackgroundSessionRow } from "./background-sessions";
import type { TerminalSessionInfo, TerminalStatus } from "../../types";

function makeStatus(overrides: Partial<TerminalStatus> = {}): TerminalStatus {
  return {
    id: "t1",
    phase: "idle",
    runningCommand: null,
    lastExitCode: null,
    cwd: "/repo",
    title: null,
    enteredStateAt: 0,
    shellIntegrationActive: false,
    ...overrides,
  };
}

function makeSession(
  overrides: Partial<TerminalSessionInfo> = {},
): TerminalSessionInfo {
  return {
    id: "t1",
    repoPath: "/Users/dave/Developer/dropseed/review",
    cwd: "/Users/dave/Developer/dropseed/review",
    title: null,
    cols: 80,
    rows: 24,
    status: makeStatus(),
    ...overrides,
  };
}

describe("toBackgroundSessionRow", () => {
  it("prefers the running command as the label", () => {
    const row = toBackgroundSessionRow(
      makeSession({ status: makeStatus({ runningCommand: "npm run dev" }) }),
    );
    expect(row.label).toBe("npm run dev");
  });

  it("falls back to the status title, then the session title, then Shell", () => {
    expect(
      toBackgroundSessionRow(
        makeSession({ status: makeStatus({ title: "zsh" }) }),
      ).label,
    ).toBe("zsh");
    expect(toBackgroundSessionRow(makeSession({ title: "my tab" })).label).toBe(
      "my tab",
    );
    expect(toBackgroundSessionRow(makeSession()).label).toBe("Shell");
  });

  it("derives the repo name from the repo path basename", () => {
    const row = toBackgroundSessionRow(makeSession());
    expect(row.repoName).toBe("review");
  });

  it("omits the cwd label when cwd is just the repo root", () => {
    const row = toBackgroundSessionRow(makeSession());
    expect(row.cwdLabel).toBeNull();
  });

  it("shows the cwd basename when it differs from the repo root", () => {
    const row = toBackgroundSessionRow(
      makeSession({
        cwd: "/Users/dave/Developer/dropseed/review/.worktrees/feature",
        status: makeStatus({
          cwd: "/Users/dave/Developer/dropseed/review/.worktrees/feature",
        }),
      }),
    );
    expect(row.cwdLabel).toBe("feature");
  });

  it("carries the phase and last exit code through unchanged", () => {
    const row = toBackgroundSessionRow(
      makeSession({
        status: makeStatus({ phase: "needs_attention", lastExitCode: 1 }),
      }),
    );
    expect(row.phase).toBe("needs_attention");
    expect(row.lastExitCode).toBe(1);
  });
});
