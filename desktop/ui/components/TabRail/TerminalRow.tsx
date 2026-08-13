import { type ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  useCurrentTerminalId,
  useSessionsByHomeKey,
} from "../../stores/selectors/terminals";
import { useHoverOpen } from "../../hooks/useHoverOpen";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { closeTerminalPane } from "../Terminal/close";
import { sessionTitle } from "../Terminal/glance";
import { jumpToTerminal } from "../Terminal/jump";
import {
  setDraggedTerminal,
  TERMINAL_SESSION_MIME,
} from "../Terminal/pane-drag";
import { TerminalGlanceCard } from "../Terminal/TerminalGlanceCard";
import { PhaseDot } from "./PhaseDot";

const NO_SESSIONS: string[] = [];

/**
 * A sidebar row's terminals, as child rows beneath it.
 *
 * Each answers "which shells are here, and what are they doing" without a
 * click. Phase and title come from the pushed status stream alone — a row is
 * permanent chrome, so it must not poll. The screen peek lives in the hover
 * card, which only fetches while it's mounted.
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

  // Same membership rule as the sidebar's grouping: a session the status stream
  // hasn't reported yet has nothing to show.
  if (!status) return null;

  const title = sessionTitle(status, session);
  const label = dead
    ? `${title} — exited${exitCode != null ? ` (${exitCode})` : ""}`
    : title;

  const activate = () => {
    setOpen(false);
    jumpToTerminal(sessionId);
  };

  return (
    <ContextMenu
      onOpenChange={(menuOpen) => {
        // The hover card and the menu would otherwise sit on the same row at
        // once, the card covering the menu it was opened next to.
        if (menuOpen) setOpen(false);
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <ContextMenuTrigger asChild>
          <PopoverTrigger asChild>
            {/* A div rather than a button for the same reason the pane grip is
                one: `draggable` on a button is where webviews disagree about
                whether a drag starts at all. */}
            <div
              role="button"
              tabIndex={0}
              draggable
              onClick={activate}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate();
                }
              }}
              onDragStart={(e) => {
                // A card left open would hang over the sidebar for the whole
                // drag — the row is being carried, not read.
                setOpen(false);
                // Latched in the module rather than component state: under
                // Tauri the drop arrives on the window after our own dragend,
                // and dataTransfer is unreadable there.
                setDraggedTerminal(sessionId);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(TERMINAL_SESSION_MIME, sessionId);
                // Some webviews won't start a drag without a text payload, and
                // an empty one is a payload that can't be pasted into whatever
                // the drag is released over.
                e.dataTransfer.setData("text/plain", "");
              }}
              onDragEnd={() => setDraggedTerminal(null)}
              {...hoverProps}
              className={clsx(
                `group flex w-full cursor-default items-center gap-1.5 rounded px-2.5
                 py-0.5 text-left transition-colors duration-100`,
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
                    exitCode === 0
                      ? "text-fg-faint/60"
                      : "text-status-rejected/70",
                  )}
                >
                  {exitCode}
                </span>
              )}
            </div>
          </PopoverTrigger>
        </ContextMenuTrigger>
        <PopoverContent
          side="right"
          align="start"
          className="w-80 p-0"
          {...hoverProps}
        >
          <TerminalGlanceCard sessionId={sessionId} />
        </PopoverContent>
      </Popover>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void closeTerminalPane(sessionId)}>
          Close terminal
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
