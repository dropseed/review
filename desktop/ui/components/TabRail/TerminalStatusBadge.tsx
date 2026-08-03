import { type ReactNode, useMemo } from "react";
import { useReviewStore } from "../../stores";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { terminalSeverity } from "../../stores/slices/terminalSlice";
import { useSessionsByHomeKey } from "../../stores/selectors/terminals";
import { useHoverOpen } from "../../hooks/useHoverOpen";
import { makeReviewKey } from "../../utils/review-key";
import { primaryStatus, tailLines } from "../Terminal/glance";
import { jumpToTerminal } from "../Terminal/jump";
import { useNow, useTerminalPeek } from "../Terminal/useTerminalPeek";
import { PhaseDot } from "./PhaseDot";
import {
  phaseLabel,
  phaseSummary,
  formatDuration,
  basename,
} from "./terminal-status-format";
import type { TerminalStatus } from "../../types";

interface TerminalStatusBadgeProps {
  repoPath: string;
  /** The row's identity — which sessions it owns is keyed off this. */
  reviewRef: string;
}

/**
 * Colored status dot + popover for a TabRail row, summarizing the terminal
 * sessions running in that row's checkout. Renders nothing when there are none.
 * Opens on hover as well as click — the badge exists to be glanced at — and
 * each session listed is a jump target.
 */
const NO_SESSIONS: string[] = [];

export function TerminalStatusBadge({
  repoPath,
  reviewRef,
}: TerminalStatusBadgeProps): ReactNode {
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const sessionsByHomeKey = useSessionsByHomeKey();
  const { open, setOpen, hoverProps } = useHoverOpen();
  const now = useNow(open);

  const ids =
    sessionsByHomeKey[makeReviewKey(repoPath, reviewRef)] ?? NO_SESSIONS;

  const statuses = useMemo(
    () =>
      ids
        .map((id) => terminalStatuses[id])
        .filter((s): s is TerminalStatus => s != null),
    [ids, terminalStatuses],
  );

  const worstPhase = terminalSeverity(statuses);
  const primary = primaryStatus(statuses);

  const peekText = useTerminalPeek(open && primary ? primary.id : null);

  if (statuses.length === 0 || worstPhase === null) return null;

  const label = `${statuses.length} terminal${
    statuses.length === 1 ? "" : "s"
  } — ${phaseSummary(worstPhase, statuses)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          {...hoverProps}
          className="flex shrink-0 items-center gap-1 rounded-full bg-fg/[0.06] px-1.5 py-px
                     text-fg-muted hover:bg-fg/[0.12] transition-colors duration-100"
          aria-label={label}
          title={label}
        >
          {/* Always shown, even for a single idle session: the point of the
              badge is "this branch has terminals", not just "one needs you". */}
          <PhaseDot phase={worstPhase} />
          <span className="text-xxs tabular-nums">{statuses.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-72 p-0"
        {...hoverProps}
      >
        <div className="px-3 py-2 border-b border-edge/40">
          <span className="text-xs font-medium text-fg-secondary">
            Terminals
          </span>
        </div>
        <div className="py-1 divide-y divide-edge/30">
          {statuses.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setOpen(false);
                jumpToTerminal(s.id);
              }}
              className="block w-full px-3 py-2 space-y-1 text-left hover:bg-fg/[0.04]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
                  <PhaseDot phase={s.phase} />
                  {phaseLabel(s.phase)}
                </span>
                <span className="text-xxs text-fg-faint shrink-0">
                  {formatDuration(Math.max(0, now - s.enteredStateAt))}
                </span>
              </div>
              {s.phase === "needs_attention" && s.attentionMessage && (
                <div className="text-xxs text-status-rejected">
                  {s.attentionMessage}
                </div>
              )}
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
            </button>
          ))}
        </div>
        {primary && (
          <div className="border-t border-edge/40 p-2">
            <div
              className="whitespace-pre font-mono text-xs overflow-auto max-h-48
                         rounded border border-edge/40 bg-surface-inset p-2 text-fg-muted"
            >
              {peekText ? (
                tailLines(peekText, 40)
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
