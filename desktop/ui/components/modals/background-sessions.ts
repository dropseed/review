import type { TerminalPhase, TerminalSessionInfo } from "../../types";
import { basename } from "../TabRail/terminal-status-format";

/**
 * One row of the Settings "Background Sessions" list — the display shape
 * derived from a raw `TerminalSessionInfo`, split out so it can be unit
 * tested without mounting the modal.
 */
export interface BackgroundSessionRow {
  id: string;
  phase: TerminalPhase;
  /** What the session is doing right now, or its title if nothing is running. */
  label: string;
  /** Basename of the session's repo path. */
  repoName: string;
  /**
   * Basename of the session's cwd, omitted when it's just the repo root (the
   * common case, where showing it again would be redundant).
   */
  cwdLabel: string | null;
  lastExitCode: number | null;
}

/** Derive a display row from a live session — pure, no formatting decisions left to the caller. */
export function toBackgroundSessionRow(
  session: TerminalSessionInfo,
): BackgroundSessionRow {
  const { status } = session;
  const repoName = basename(session.repoPath);
  const cwdName = basename(session.cwd);
  return {
    id: session.id,
    phase: status.phase,
    label: status.runningCommand ?? status.title ?? session.title ?? "Shell",
    repoName,
    cwdLabel: cwdName === repoName ? null : cwdName,
    lastExitCode: status.lastExitCode,
  };
}
