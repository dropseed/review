import { type ReactNode, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  useTabGlance,
  useTabsByWorkspaceId,
} from "../../stores/selectors/terminals";
import { useWorkspaces } from "../../stores/selectors/workspaces";
import { jumpToTab } from "./jump";
import { findTab, type TerminalTab } from "../../stores/slices/terminalSlice";
import { PhaseDot } from "../Sidebar/PhaseDot";
import { expandedLeafIds } from "./pane-tree";
import { closeTerminalPane } from "./close";
import { PaneTree } from "./PaneTree";
import type { Workspace } from "../../types";

/** How wide one terminal is here — a column, not a thumbnail. */
const COLUMN_WIDTH = "w-[28rem]";

/**
 * Every terminal in the app, side by side.
 *
 * The stage answers "what am I doing", one workspace at a time; this answers
 * "what is everything doing" — a row across all of them, scrolled horizontally
 * rather than sampled, because a screen you have to click to see is a screen
 * you will not check. There is no code half: a diff is something you read, and
 * nothing is being read while this is up.
 *
 * It *replaces* the dock's contents rather than sitting beside them. An xterm
 * element lives in the module registry and is re-parented into whichever pane
 * mounts it (see `registry.ts`), so a terminal can be in exactly one place at a
 * time — the panel has to let go of its panes for this view to adopt them, and
 * gets them back the same way when the view closes.
 */
export function TerminalOverview(): ReactNode {
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const setTerminalOverview = useReviewStore((s) => s.setTerminalOverview);
  const byWorkspace = useTabsByWorkspaceId();
  const workspaces = useWorkspaces();

  // The row is almost entirely xterm, and xterm cancels the wheel events it
  // sees — its viewport preventDefaults anything with a vertical component to
  // drive scrollback, which also kills the browser's default handling of the
  // *horizontal* component. So a trackpad swipe over a terminal never reached
  // this container, and the row read as unscrollable. Intercept in the capture
  // phase, before any pane's listener: a sideways gesture (or Shift+wheel, the
  // mouse spelling of one) scrolls the row by hand and stops there; a vertical
  // one still falls through to whichever scrollback it was over.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!sideways && !event.shiftKey) return;
      const delta = sideways ? event.deltaX : event.deltaY;
      scroller.scrollLeft +=
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * 16 : delta;
      event.preventDefault();
      event.stopPropagation();
    };
    // React's own onWheel is passive at the root — preventDefault would be
    // ignored — so this listener is attached natively.
    scroller.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      scroller.removeEventListener("wheel", onWheel, { capture: true });
  }, [scroller]);

  // Queue order, so the row reads the way the sidebar does — a terminal is
  // found here by remembering where its card sits, not by scanning titles. A
  // tab whose workspace the queue hasn't caught up with lands in no column and
  // appears when it has, exactly as the sidebar's own rows do.
  const columns = useMemo(
    () =>
      workspaces.flatMap((workspace) =>
        (byWorkspace[workspace.id] ?? []).flatMap((tabId) => {
          const tab = findTab(terminalTabs, tabId);
          return tab ? [{ workspace, tab }] : [];
        }),
      ),
    [workspaces, byWorkspace, terminalTabs],
  );

  return (
    // Not a card of its own: the columns are the panels here, each drawn the
    // way the terminal panel is, so the row reads as that panel repeated —
    // one per terminal, side by side — rather than one wide surface with
    // dividers. This frame is just the strip above them and the scroll.
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 select-none items-center gap-2 px-1 pb-2">
        <span className="text-xs text-fg-muted">All terminals</span>
        {columns.length > 0 && (
          <span className="text-xxs text-fg-faint tabular-nums">
            {columns.length}
          </span>
        )}
        {/* The way out, on the surface that took the room — the sidebar's
            button is the other one, and it is gone whenever the sidebar is
            collapsed. */}
        <button
          type="button"
          onClick={() => setTerminalOverview(false)}
          aria-label="Close terminal overview"
          title="Close terminal overview (Esc)"
          className="ml-auto rounded px-2 py-0.5 text-xs text-fg-muted
                     hover:bg-fg/[0.06] hover:text-fg-secondary"
        >
          Done
        </button>
      </div>

      {columns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-xs text-fg-faint">
          Nothing is running.
        </div>
      ) : (
        // Fixed-width columns that scroll rather than share the width: eight
        // terminals squeezed into one screen are eight things none of which can
        // be read, and the point of the row is that each one still is.
        <div
          ref={setScroller}
          className="min-h-0 flex-1 overflow-x-auto scrollbar-thin"
        >
          <div className="flex h-full gap-3">
            {columns.map(({ workspace, tab }) => (
              <OverviewTab key={tab.id} workspace={workspace} tab={tab} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One tab in the row: who it belongs to, what it is doing, and its panes.
 *
 * Rendered with the same `PaneTree` the panel uses, so a split tab arrives here
 * split — the layout a person built is part of how they recognize the terminal.
 */
function OverviewTab({
  workspace,
  tab,
}: {
  workspace: Workspace;
  tab: TerminalTab;
}): ReactNode {
  const activeTabId = useReviewStore((s) => s.activeTabId);
  const setFocusedTerminalPane = useReviewStore(
    (s) => s.setFocusedTerminalPane,
  );
  const glance = useTabGlance(tab.id);

  return (
    // Each column is its own panel — the same card the terminal panel draws,
    // so a terminal looks like itself here: the header bar where the tab strip
    // would be, the panes on the card's surface, and the gap between cards
    // saying where one terminal ends and the next begins.
    <div
      className={clsx(
        "panel-card flex h-full shrink-0 flex-col overflow-hidden bg-surface-inset",
        COLUMN_WIDTH,
      )}
    >
      {/* "Take me to this" — the one verb `jump.ts` exists for, shared with the
          sidebar's terminal rows and ⌘K's. Doing it by hand here focused the
          workspace and selected the tab but left the panel hidden when the
          stage was on the code half, so the click appeared to do nothing to the
          terminal it was aimed at. */}
      <button
        type="button"
        onClick={() => jumpToTab(tab.id)}
        // The full chain in the tooltip, the leaf alone in the strip below:
        // a nested workspace's own title rarely says what it belongs to, and
        // this is the one place here with room to say it.
        title={`Go to ${glance?.title ?? "terminal"} in ${[
          ...workspace.ancestors.map((a) => a.displayTitle),
          workspace.displayTitle,
        ].join(" › ")}`}
        className="flex shrink-0 select-none items-center gap-1.5 border-b
                   border-edge/60 px-2 py-1 text-left text-xs text-fg-muted
                   hover:text-fg-secondary"
      >
        <PhaseDot
          phase={glance?.severity ?? "idle"}
          dead={glance?.allDead ?? false}
          agent={glance?.agent ?? null}
        />
        <span className="min-w-0 truncate">{glance?.title ?? "shell"}</span>
        {/* The card it lives under, quieter than its own name: the column is a
            terminal first, and its workspace is how you place it. */}
        <span className="ml-auto min-w-0 shrink-0 truncate pl-2 text-fg-faint">
          {workspace.displayTitle}
        </span>
      </button>

      <div className="relative min-h-0 flex-1">
        <PaneTree
          node={tab.root}
          path={[]}
          canFold={expandedLeafIds(tab.root).length > 1}
          tabId={tab.id}
          // A column here is a look at the terminal, not a place it lives:
          // render each grid at its true size, scaled to the column, so
          // opening the overview stops resizing every session to 28rem.
          viewer
          // Only the tab the panel was showing keeps its focused pane lit, so
          // opening the row doesn't have every column call for the keyboard at
          // once — and the one you were typing in is still the one you are
          // typing in.
          tabActive={tab.id === activeTabId}
          focusedId={tab.focused}
          onFocus={(id) => setFocusedTerminalPane(tab.id, id)}
          onClose={(id) => void closeTerminalPane(id)}
        />
      </div>
    </div>
  );
}
