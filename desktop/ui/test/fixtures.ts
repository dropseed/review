/**
 * Fixture builders shared across tests.
 *
 * A `TerminalStatus` has nine fields and most tests care about one of them, so
 * every suite that touched one had grown its own copy of the same literal. One
 * builder here means a field added to the type is fixed in one place, and each
 * suite states only the part it is actually about.
 */

import type {
  Attachment,
  TerminalPhase,
  TerminalSessionInfo,
  TerminalStatus,
  Workspace,
} from "../types";

/**
 * A workspace as the backend hands it over.
 *
 * `displayTitle` follows the backend's own ladder unless it is overridden, so a
 * suite states the title *or* the attachments and gets the same answer the app
 * would render.
 */
export function workspace(
  id: string,
  overrides: Partial<Workspace> = {},
): Workspace {
  const title = overrides.title ?? null;
  const attachments = overrides.attachments ?? [];
  return {
    id,
    title,
    displayTitle: title || derivedTitle(attachments),
    attachments,
    autoCreated: false,
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

/** The backend's derived title, minus the live-terminal rung. */
function derivedTitle(attachments: Attachment[]): string {
  const first = attachments[0];
  if (!first) return "Untitled";
  const name = first.path.slice(first.path.lastIndexOf("/") + 1);
  return first.refName ? `${name} · ${first.refName}` : name;
}

/** One repo tab. */
export function attachment(
  path: string,
  refName: string | null = null,
): Attachment {
  return { path, refName };
}

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

/** A terminal session record, quiet unless overridden. */
export function terminalSession(
  id = "t1",
  overrides: Partial<TerminalSessionInfo> = {},
): TerminalSessionInfo {
  return {
    id,
    repoPath: "/repo",
    workspaceId: null,
    cwd: "/repo",
    title: null,
    cols: 80,
    rows: 24,
    status: terminalStatus("idle", { id }),
    ...overrides,
  };
}
