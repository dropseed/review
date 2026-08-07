/**
 * Fixture builders shared across tests.
 *
 * A `TerminalStatus` has ten fields and most tests care about one of them, so
 * every suite that touched one had grown its own copy of the same literal. One
 * builder here means a field added to the type is fixed in one place, and each
 * suite states only the part it is actually about.
 */

import type {
  TerminalPhase,
  TerminalSessionInfo,
  TerminalStatus,
} from "../types";

/** A terminal status in `phase`, with everything else quiet unless overridden. */
export function terminalStatus(
  phase: TerminalPhase = "idle",
  overrides: Partial<TerminalStatus> = {},
): TerminalStatus {
  return {
    id: "t1",
    phase,
    runningCommand: null,
    lastExitCode: null,
    cwd: null,
    title: null,
    enteredStateAt: 0,
    shellIntegrationActive: false,
    kittyFlags: 0,
    attentionMessage: null,
    ...overrides,
  };
}

/** A terminal session record, quiet unless overridden. */
export function terminalSession(
  id = "t1",
  overrides: Partial<TerminalSessionInfo> = {},
): TerminalSessionInfo {
  return {
    id,
    repoPath: "/repo",
    cwd: "/repo",
    title: null,
    cols: 80,
    rows: 24,
    status: terminalStatus("idle", { id }),
    ...overrides,
  };
}
