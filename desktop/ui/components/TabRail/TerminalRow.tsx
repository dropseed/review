import { type ReactNode } from "react";
import { clsx } from "clsx";
import { useHoverOpen } from "../../hooks/useHoverOpen";
import { useTabGlance } from "../../stores/selectors/terminals";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { jumpToTab, jumpToTerminal } from "../Terminal/jump";
import {
  setDraggedTerminal,
  TERMINAL_SESSION_MIME,
} from "../Terminal/pane-drag";
import { TerminalGlanceCard } from "../Terminal/TerminalGlanceCard";
import { TerminalMenuItems } from "./ActionMenu";
import { PaneGlyphs } from "./PaneGlyphs";
import { activateOnKey } from "./row-chrome";

/**
 * One terminal tab, as a row under the work card it is attached to.
 *
 * A tab, not a session: panes are the panel's own layout, and a tab that has
 * been split is still one terminal as far as the rest of the app is concerned.
 * The row answers "which shells are here, and what are they doing" without a
 * click — phase and title come from the pushed status stream alone, since a row
 * is permanent chrome and must not poll. The screen peek lives in the hover
 * card, which only fetches while it's mounted.
 *
 * The repos layer has no rows like this: a terminal belongs to the work item
 * that claimed it, or to nothing, and a branch row is neither.
 */
export function TerminalRow({
  tabId,
  isActive,
}: {
  tabId: string;
  isActive: boolean;
}): ReactNode {
  const glance = useTabGlance(tabId);
  const { open, setOpen, hoverProps } = useHoverOpen();

  if (!glance) return null;
  const { allDead, exitCode, title, leafIds, primaryId, panes } = glance;

  const label = allDead
    ? `${title} — exited${exitCode != null ? ` (${exitCode})` : ""}`
    : title;

  const activate = () => {
    setOpen(false);
    jumpToTab(tabId);
  };

  const activatePane = (paneId: string) => {
    setOpen(false);
    jumpToTerminal(paneId);
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
              onKeyDown={activateOnKey(activate)}
              onDragStart={(e) => {
                // A card left open would hang over the sidebar for the whole
                // drag — the row is being carried, not read.
                setOpen(false);
                // Latched in the module rather than component state: under
                // Tauri the drop arrives on the window after our own dragend,
                // and dataTransfer is unreadable there. One of the tab's
                // sessions names it; the drop takes the whole tab either way
                // (see `terminalsInFlight`).
                setDraggedTerminal(primaryId);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(TERMINAL_SESSION_MIME, primaryId);
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
              {/* One glyph, or one per pane once the tab is split — which is
                  also what says how many shells the row stands for. */}
              <PaneGlyphs panes={panes} onSelect={activatePane} />
              <span
                className={clsx(
                  "min-w-0 flex-1 truncate text-[11px]",
                  allDead
                    ? "text-fg-faint/50"
                    : isActive
                      ? "text-fg-secondary"
                      : "text-fg-faint group-hover:text-fg-muted",
                )}
              >
                {title}
              </span>
              {allDead && exitCode != null && (
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
          <TerminalGlanceCard sessionId={primaryId} />
        </PopoverContent>
      </Popover>
      <ContextMenuContent>
        <TerminalMenuItems sessionIds={leafIds} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
