import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import {
  selectTerminalIdsForRow,
  terminalSeverity,
} from "../../stores/slices/terminalSlice";
import {
  phaseDotClass,
  phaseLabel,
  formatDuration,
  basename,
} from "./terminal-status-format";
import type { TerminalStatus } from "../../types";

interface TerminalStatusBadgeProps {
  repoPath: string;
  /** The row's dedicated worktree, if any — scopes sessions to it. */
  worktreePath?: string;
}

/**
 * Colored status dot + popover for a TabRail row, summarizing the terminal
 * sessions running for that row's repo (or worktree, when the row has a
 * dedicated one). Renders nothing when there are no sessions.
 */
export function TerminalStatusBadge({
  repoPath,
  worktreePath,
}: TerminalStatusBadgeProps): ReactNode {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [freshPeek, setFreshPeek] = useState<string | null>(null);

  const ids = useMemo(
    () => selectTerminalIdsForRow({ terminalSessions }, repoPath, worktreePath),
    [terminalSessions, repoPath, worktreePath],
  );

  const statuses = useMemo(
    () =>
      ids
        .map((id) => terminalStatuses[id])
        .filter((s): s is TerminalStatus => s != null),
    [ids, terminalStatuses],
  );

  const worstPhase = terminalSeverity(statuses);
  const primary = worstPhase
    ? (statuses.find((s) => s.phase === worstPhase) ?? null)
    : null;

  // Tick time-in-state only while the popover is open.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [open]);

  // Refresh the content peek for the highest-severity session on open.
  useEffect(() => {
    if (!open || !primary) {
      setFreshPeek(null);
      return;
    }
    let cancelled = false;
    getApiClient()
      .terminalPeek(primary.id)
      .then((peek) => {
        if (!cancelled) setFreshPeek(peek);
      })
      .catch(() => {
        // Peek can legitimately fail (e.g. session just exited) — leave the
        // popover in its empty state rather than surfacing an error.
        if (!cancelled) setFreshPeek("");
      });
    return () => {
      cancelled = true;
    };
    // `primary` is recomputed every render; key off its id (a stable
    // primitive) so this only refires when the popover opens or the
    // highest-severity session actually changes.
  }, [open, primary?.id]);

  if (statuses.length === 0 || worstPhase === null) return null;

  // Pulled on open via terminalPeek; null until it resolves. Kept in a stable
  // box (rendered whenever there's a primary session) so the popover doesn't
  // jump between the loading and loaded states.
  const peekText = freshPeek;

  const label = `${statuses.length} terminal${
    statuses.length === 1 ? "" : "s"
  } — ${phaseLabel(worstPhase)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center gap-1 rounded-full bg-fg/[0.06] px-1.5 py-px
                     text-fg-muted hover:bg-fg/[0.12] transition-colors duration-100"
          aria-label={label}
          title={label}
        >
          {/* Always shown, even for a single idle session: the point of the
              badge is "this branch has terminals", not just "one needs you". */}
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${phaseDotClass(
              worstPhase,
            )} ${worstPhase === "working" || worstPhase === "needs_attention" ? "animate-pulse" : ""}`}
          />
          <span className="text-xxs tabular-nums">{statuses.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-0">
        <div className="px-3 py-2 border-b border-edge/40">
          <span className="text-xs font-medium text-fg-secondary">
            Terminals
          </span>
        </div>
        <div className="py-1 divide-y divide-edge/30">
          {statuses.map((s) => (
            <div key={s.id} className="px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${phaseDotClass(s.phase)}`}
                  />
                  {phaseLabel(s.phase)}
                </span>
                <span className="text-xxs text-fg-faint shrink-0">
                  {formatDuration(Math.max(0, now - s.enteredStateAt))}
                </span>
              </div>
              {s.runningCommand && (
                <div className="font-mono text-xxs text-fg-muted truncate">
                  {s.runningCommand}
                </div>
              )}
              <div className="flex items-center gap-2 text-xxs text-fg-faint">
                {s.lastExitCode != null && (
                  <span
                    className={
                      s.lastExitCode === 0
                        ? "text-status-approved"
                        : "text-status-rejected"
                    }
                  >
                    {s.lastExitCode === 0 ? "✓" : "✗"} {s.lastExitCode}
                  </span>
                )}
                {s.cwd && <span className="truncate">{basename(s.cwd)}</span>}
              </div>
            </div>
          ))}
        </div>
        {primary && (
          <div className="border-t border-edge/40 p-2">
            <div
              className="whitespace-pre font-mono text-xs overflow-auto max-h-48
                         rounded border border-edge/40 bg-surface-inset p-2 text-fg-muted"
            >
              {peekText ? (
                peekText
              ) : (
                <span className="text-fg-faint italic">
                  {peekText === null ? "Loading…" : "No output"}
                </span>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
