/**
 * Fixture builders shared across tests.
 *
 * A `TerminalStatus` has nine fields and most tests care about one of them, so
 * every suite that touched one had grown its own copy of the same literal. One
 * builder here means a field added to the type is fixed in one place, and each
 * suite states only the part it is actually about.
 */

import type { TerminalPhase, TerminalStatus } from "../types";

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
    attentionMessage: null,
    ...overrides,
  };
}
