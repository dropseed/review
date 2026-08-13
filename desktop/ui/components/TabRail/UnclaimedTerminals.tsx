import { type ReactNode, useMemo } from "react";
import { useReviewStore } from "../../stores";
import {
  useTabGlance,
  useUnattachedTabIds,
} from "../../stores/selectors/terminals";
import { jumpToTab, jumpToTerminal } from "../Terminal/jump";
import {
  setDraggedTerminal,
  TERMINAL_SESSION_MIME,
} from "../Terminal/pane-drag";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { TerminalMenuItems } from "./ActionMenu";
import { applyWorkDrop } from "./work-drag";
import { PaneGlyphs } from "./PaneGlyphs";
import { activateOnKey } from "./row-chrome";
import { terminalBandRows } from "./terminal-band";
import { useWorkContext } from "./work-context";

/**
 * "Unclaimed terminals": tabs running under no work item.
 *
 * The list above is the user's own, and a terminal they never added to it is
 * still running — often the agent that is doing the work. Each row is one
 * gesture from becoming a work item, by the `+` or by dragging it onto a card,
 * which is the point: this is a staging area for the section above, not a
 * second list to maintain. Attach the tab and the row leaves on its own.
 *
 * Everything else that was ever banded here — branches with edits, PRs waiting
 * on you — is a fact the repo rows below already carry, on the row itself and
 * on any work card that covers it. See `terminal-band` for what that leaves.
 */
export function UnclaimedTerminals(): ReactNode {
  const ctx = useWorkContext();
  const tabs = useReviewStore((s) => s.terminalTabs);
  const sessions = useReviewStore((s) => s.terminalSessions);
  const tabIds = useUnattachedTabIds();
  const itemCount = useReviewStore((s) => s.workItems.length);

  const rows = useMemo(
    () => terminalBandRows(ctx, { tabIds, tabs, sessions }),
    [ctx, tabIds, tabs, sessions],
  );

  if (rows.length === 0) return null;

  return (
    <div className="border-b border-b-edge/40 pb-1">
      <div className="px-2.5 pb-0.5 pt-1.5 text-[9px] font-medium uppercase tracking-[0.08em] text-fg-faint/60">
        Unclaimed terminals
      </div>
      {rows.map((row) => (
        <TerminalActivityRow
          key={row.key}
          tabId={row.tabId}
          repoName={row.repoName}
          itemCount={itemCount}
        />
      ))}
    </div>
  );
}

/**
 * One running terminal: where it is, what it's doing, and the one gesture that
 * claims it.
 *
 * Draggable for the same reason the rows under a card are: a card takes a
 * terminal drop already, and the `+` (which makes a card of its own) is the
 * only other way to move one. Dragging is how you attach it to an item that
 * already exists.
 */
function TerminalActivityRow({
  tabId,
  repoName,
  itemCount,
}: {
  tabId: string;
  repoName: string;
  /** Where a new card goes — the end of the "Working on" list. */
  itemCount: number;
}): ReactNode {
  const glance = useTabGlance(tabId);

  if (!glance) return null;
  const { severity, allDead, title, leafIds, primaryId, statuses, panes } =
    glance;
  const primary = statuses.find((s) => s.id === primaryId) ?? statuses[0];
  const meta = allDead
    ? "exited"
    : (primary?.runningCommand ?? (severity ?? "idle").replace(/_/g, " "));

  const activate = () => jumpToTab(tabId);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          draggable
          onClick={activate}
          onKeyDown={activateOnKey(activate)}
          onDragStart={(e) => {
            // Latched in the module rather than component state: under Tauri
            // the drop arrives on the window after our own dragend, and
            // dataTransfer is unreadable there. One of the tab's sessions names
            // it; the drop takes the whole tab (see `terminalsInFlight`).
            setDraggedTerminal(primaryId);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(TERMINAL_SESSION_MIME, primaryId);
            // Some webviews won't start a drag without a text payload, and an
            // empty one can't be pasted into whatever it's released on.
            e.dataTransfer.setData("text/plain", "");
          }}
          onDragEnd={() => setDraggedTerminal(null)}
          className="group flex cursor-default items-center gap-1.5 rounded-sm px-2.5 py-0.5
                     transition-colors duration-100 hover:bg-fg/[0.04]"
          title={`${repoName} — ${meta}`}
        >
          <span className="shrink-0 text-[11px] text-fg-faint">{repoName}</span>
          <span className="shrink-0 text-[10px] text-fg-faint/40">·</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
            {title}
            <span className="text-fg-faint/50"> — {meta}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {/* One glyph, or one per pane once the tab is split. */}
            <PaneGlyphs panes={panes} onSelect={jumpToTerminal} />
            <button
              type="button"
              aria-label="Add to Working on"
              title="Add to Working on"
              onClick={(e) => {
                e.stopPropagation();
                // The drop path, so the `+`, the menu's "New item" and a drag
                // past the last card all make the same card.
                void applyWorkDrop(
                  { kind: "gap", index: itemCount },
                  { kind: "terminal", sessionIds: leafIds },
                );
              }}
              className="flex h-4 w-4 items-center justify-center rounded text-[11px]
                         text-fg-faint opacity-0 transition-opacity duration-100
                         hover:bg-fg/[0.08] hover:text-fg-secondary group-hover:opacity-100"
            >
              +
            </button>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <TerminalMenuItems sessionIds={leafIds} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
