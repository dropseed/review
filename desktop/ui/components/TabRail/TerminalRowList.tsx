import { type ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  useCurrentTerminalId,
  useSessionsByHomeKey,
} from "../../stores/selectors/terminals";
import { useHoverOpen } from "../../hooks/useHoverOpen";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { sessionTitle } from "../Terminal/glance";
import { jumpToTerminal } from "../Terminal/jump";
import { TerminalGlanceCard } from "../Terminal/TerminalGlanceCard";
import { PhaseDot } from "./PhaseDot";

const NO_SESSIONS: string[] = [];

/**
 * A sidebar row's terminals, as child rows beneath it.
 *
 * The badge answers "this row has shells"; these answer "which ones, and what
 * are they doing" without a click. Phase and title come from the pushed status
 * stream alone — a row is permanent chrome, so it must not poll. The screen
 * peek lives in the hover card, which only fetches while it's mounted.
 *
 * Order is the grouping's own (session creation order), deliberately not
 * severity — phase changes every few seconds, and rows that reshuffle under the
 * cursor are the failure the sidebar's ordering rules exist to avoid.
 */
export function TerminalRowList({
  reviewKey,
}: {
  reviewKey: string;
}): ReactNode {
  const sessionsByHomeKey = useSessionsByHomeKey();
  const currentTerminalId = useCurrentTerminalId();
  const ids = sessionsByHomeKey[reviewKey] ?? NO_SESSIONS;

  if (ids.length === 0) return null;

  return (
    <div className="ml-[18px] border-l border-l-fg/[0.06]">
      {ids.map((id) => (
        <TerminalRow
          key={id}
          sessionId={id}
          isActive={id === currentTerminalId}
        />
      ))}
    </div>
  );
}

function TerminalRow({
  sessionId,
  isActive,
}: {
  sessionId: string;
  isActive: boolean;
}): ReactNode {
  const status = useReviewStore((s) => s.terminalStatuses[sessionId]);
  const session = useReviewStore((s) => s.terminalSessions[sessionId]);
  const dead = useReviewStore((s) => sessionId in s.terminalExited);
  const exitCode = useReviewStore((s) => s.terminalExited[sessionId]);
  const { open, setOpen, hoverProps } = useHoverOpen();

  // Same membership rule as the badge: a session the status stream hasn't
  // reported yet has nothing to show.
  if (!status) return null;

  const title = sessionTitle(status, session);
  const label = dead
    ? `${title} — exited${exitCode != null ? ` (${exitCode})` : ""}`
    : title;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            jumpToTerminal(sessionId);
          }}
          {...hoverProps}
          className={clsx(
            `group flex w-full items-center gap-1.5 rounded px-2.5 py-0.5
             text-left transition-colors duration-100`,
            isActive ? "bg-fg/[0.05]" : "hover:bg-fg/[0.03]",
          )}
          aria-current={isActive ? "true" : undefined}
          title={label}
        >
          <PhaseDot phase={status.phase} dead={dead} />
          <span
            className={clsx(
              "min-w-0 flex-1 truncate text-[11px]",
              dead
                ? "text-fg-faint/50"
                : isActive
                  ? "text-fg-secondary"
                  : "text-fg-faint group-hover:text-fg-muted",
            )}
          >
            {title}
          </span>
          {dead && exitCode != null && (
            <span
              className={clsx(
                "shrink-0 text-xxs tabular-nums",
                exitCode === 0 ? "text-fg-faint/60" : "text-status-rejected/70",
              )}
            >
              {exitCode}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-80 p-0"
        {...hoverProps}
      >
        <TerminalGlanceCard sessionId={sessionId} />
      </PopoverContent>
    </Popover>
  );
}
