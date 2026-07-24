import { describe, it, expect } from "vitest";
import {
  phaseDotClass,
  phaseLabel,
  formatDuration,
  basename,
} from "./terminal-status-format";
import type { TerminalPhase } from "../../types";

describe("phaseDotClass", () => {
  it("maps each phase to its status color", () => {
    const cases: Array<[TerminalPhase, string]> = [
      ["needs_attention", "bg-status-rejected"],
      ["waiting_for_input", "bg-blue"],
      ["working", "bg-status-warning"],
      ["idle", "bg-fg-faint"],
    ];
    for (const [phase, expected] of cases) {
      expect(phaseDotClass(phase)).toBe(expected);
    }
  });
});

describe("phaseLabel", () => {
  it("humanizes each phase", () => {
    expect(phaseLabel("needs_attention")).toBe("Needs attention");
    expect(phaseLabel("waiting_for_input")).toBe("Waiting for input");
    expect(phaseLabel("working")).toBe("Working");
    expect(phaseLabel("idle")).toBe("Idle");
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("formats sub-hour durations as minutes", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(3 * 60_000)).toBe("3m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("formats hour-plus durations as hours and minutes", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h 0m");
    expect(formatDuration((2 * 60 + 5) * 60_000)).toBe("2h 5m");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-500)).toBe("0s");
  });
});

describe("basename", () => {
  it("returns the last path segment", () => {
    expect(basename("/repo/.worktrees/feature")).toBe("feature");
  });

  it("ignores a trailing slash", () => {
    expect(basename("/repo/.worktrees/feature/")).toBe("feature");
  });

  it("returns the input for a path with no separator", () => {
    expect(basename("feature")).toBe("feature");
  });
});
