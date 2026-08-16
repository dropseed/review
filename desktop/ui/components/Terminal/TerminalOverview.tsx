import { type ReactNode, useMemo } from "react";
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
    <div className="panel-card flex h-full w-full flex-col overflow-hidden bg-surface-inset">
      <div className="flex shrink-0 select-none items-center gap-2 border-b border-edge/60 px-3 py-1">
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
        <div className="min-h-0 flex-1 overflow-x-auto scrollbar-thin">
          <div className="flex h-full gap-2 p-2">
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
    // No card, no border, no surface of its own: the terminals already sit on
    // the panel's, and a box drawn around each one turns a row of shells into a
    // row of widgets — every edge one more thing between the reader and the
    // text they came here for. What separates the columns is the gap, and what
    // labels one is the bar over it.
    <div className={clsx("flex h-full shrink-0 flex-col", COLUMN_WIDTH)}>
      {/* "Take me to this" — the one verb `jump.ts` exists for, shared with the
          sidebar's terminal rows and ⌘K's. Doing it by hand here focused the
          workspace and selected the tab but left the panel hidden when the
          stage was on the code half, so the click appeared to do nothing to the
          terminal it was aimed at. */}
      <button
        type="button"
        onClick={() => jumpToTab(tab.id)}
        title={`Go to ${glance?.title ?? "terminal"} in ${workspace.displayTitle}`}
        className="flex shrink-0 select-none items-center gap-1.5 px-1 pb-1
                   text-left text-xs text-fg-muted hover:text-fg-secondary"
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
