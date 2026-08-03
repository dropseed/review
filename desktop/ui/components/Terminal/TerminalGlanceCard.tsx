import { memo, type ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { PhaseDot } from "../TabRail/PhaseDot";
import {
  basename,
  formatDuration,
  phaseLabel,
} from "../TabRail/terminal-status-format";
import { sessionTitle, tailLines } from "./glance";
import { useNow, useTerminalPeek } from "./useTerminalPeek";

interface TerminalGlanceCardProps {
  sessionId: string;
  className?: string;
}

/** As many trailing screen lines as the card's peek box has room for. */
const PEEK_LINES = 12;

/**
 * One terminal, summarized for a glance: phase, how long it's been that way,
 * what it said when it asked for attention, and the tail of its screen.
 *
 * This is the card every hover and overview surface shows, so "what does a
 * terminal look like from outside" is answered once. It reads the store and
 * pulls its own peek — mounting one is the whole API.
 */
export const TerminalGlanceCard = memo(function TerminalGlanceCard({
  sessionId,
  className,
}: TerminalGlanceCardProps): ReactNode {
  const status = useReviewStore((s) => s.terminalStatuses[sessionId]);
  const session = useReviewStore((s) => s.terminalSessions[sessionId]);
  const dead = useReviewStore((s) => sessionId in s.terminalExited);
  const exitCode = useReviewStore((s) => s.terminalExited[sessionId]);

  const now = useNow(!dead);
  const peek = useTerminalPeek(dead ? null : sessionId);

  if (!status) return null;

  const title = sessionTitle(status, session);
  const stateLabel = dead
    ? `exited${exitCode != null ? ` (${exitCode})` : ""}`
    : `${phaseLabel(status.phase)} · ${formatDuration(
        Math.max(0, now - status.enteredStateAt),
      )}`;
  const cwd = status.cwd ?? session?.cwd;
  const peekTail = peek ? tailLines(peek, PEEK_LINES) : null;

  return (
    <div className={clsx("overflow-hidden text-left", className)}>
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <PhaseDot phase={status.phase} dead={dead} />
        <span className="min-w-0 truncate text-xs text-fg-secondary">
          {title}
        </span>
        <span className="ml-auto shrink-0 pl-2 text-xxs text-fg-faint tabular-nums">
          {stateLabel}
        </span>
      </div>
      {status.phase === "needs_attention" && status.attentionMessage && (
        <div className="px-2.5 pt-1 text-xxs text-status-rejected">
          {status.attentionMessage}
        </div>
      )}
      {(status.runningCommand || cwd) && (
        <div className="flex items-center gap-2 px-2.5 pt-1 text-xxs text-fg-faint">
          {status.runningCommand && (
            <span className="min-w-0 truncate font-mono">
              {status.runningCommand}
            </span>
          )}
          {cwd && (
            <span className="min-w-0 shrink-0 truncate">{basename(cwd)}</span>
          )}
        </div>
      )}
      {!dead && (
        <div className="p-2">
          <div
            className="flex h-40 flex-col justify-end overflow-hidden rounded border
                       border-edge/40 bg-surface-inset px-2 py-1.5"
          >
            {peekTail ? (
              <pre className="overflow-hidden font-mono text-[10px] leading-[1.4] text-fg-muted">
                {peekTail}
              </pre>
            ) : (
              <span className="text-xxs italic text-fg-faint">
                {peek === null ? "Loading…" : "No output"}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
