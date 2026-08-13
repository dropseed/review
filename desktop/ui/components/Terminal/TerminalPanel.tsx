import { type ReactElement, type ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  isOrphanedSession,
  type TerminalTab,
} from "../../stores/slices/terminalSlice";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { basename } from "../TabRail/terminal-status-format";
import { PhaseDot } from "../TabRail/PhaseDot";
import { RICH_TOOLTIP_CLASS, SimpleTooltip } from "../ui/tooltip";
import { tabGlance } from "./glance";
import { TerminalGlanceCard } from "./TerminalGlanceCard";
import { TerminalOverview } from "./TerminalOverview";
import {
  collectLeafIds,
  expandedLeafIds,
  type SplitDirection,
} from "./pane-tree";
import {
  DROP_RING,
  TERMINAL_PANE_MIME,
  TERMINAL_TAB_MIME,
  clearTabDropTarget,
  draggedTabSource,
  pointerLeft,
  setDraggedTab,
  setTabDropTarget,
  usePaneDragActive,
  useTabDragSource,
  useTabDropTarget,
} from "./pane-drag";
import { closeTerminalPane, closeTerminalTab } from "./close";
import { openTerminalTab } from "./newTab";
import { PaneTree, PaneButton } from "./PaneTree";
import { WarningIcon } from "../ui/icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { TerminalMenuItems } from "../TabRail/ActionMenu";

export function TerminalPanel(): ReactNode {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const terminalCheckouts = useReviewStore((s) => s.terminalCheckouts);
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const activeTabId = useReviewStore((s) => s.activeTabId);

  const splitTerminal = useReviewStore((s) => s.splitTerminal);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);
  const moveTab = useReviewStore((s) => s.moveTab);
  const setFocusedTerminalPane = useReviewStore(
    (s) => s.setFocusedTerminalPane,
  );
  const movePaneToTab = useReviewStore((s) => s.movePaneToTab);
  const movePaneToNewTab = useReviewStore((s) => s.movePaneToNewTab);
  const terminalDockSide = useReviewStore((s) => s.terminalDockSide);
  const toggleTerminalDockSide = useReviewStore(
    (s) => s.toggleTerminalDockSide,
  );
  const maximized = useReviewStore((s) => s.terminalPanelMode === "maximized");
  const toggleTerminalPanelMaximized = useReviewStore(
    (s) => s.toggleTerminalPanelMaximized,
  );
  const toggleTerminalPanel = useReviewStore((s) => s.toggleTerminalPanel);
  const overviewOpen = useReviewStore((s) => s.terminalOverviewOpen);
  const toggleTerminalOverview = useReviewStore(
    (s) => s.toggleTerminalOverview,
  );
  const setTerminalOverviewOpen = useReviewStore(
    (s) => s.setTerminalOverviewOpen,
  );

  // Tab drag-to-reorder. The in-flight tab lives in the pane-drag module
  // rather than component state, because under Tauri the drop lands on the
  // window (useTerminalFileDrop), not on these elements — the module is what
  // both paths share. Its presence also marks "this is our own tab drag", so a
  // file dragged in from the OS is never treated as a reorder.
  const draggedTab = useTabDragSource();

  // A pane dragged by its grip can also be dropped up here: onto a tab, to move
  // it into that tab, or onto the slot that appears at the end of the strip, to
  // pull it out into a tab of its own. `draggedPaneId` is what the panel reacts
  // to — the strip has to grow that slot while the drag is in flight, not once
  // something is hovered.
  const draggedPaneId = usePaneDragActive();
  // Where the pane or tab in flight would land, published by whichever channel
  // saw the pointer last (HTML5 here, window-level events under Tauri).
  const tabDropTarget = useTabDropTarget();

  // ⌘D / ⇧⌘D pane splits are dispatched by useKeyboardNavigation, which routes
  // the chord to whichever pane has focus.

  const activeTab = terminalTabs.find((tab) => tab.id === activeTabId) ?? null;

  // Offered only for a pane that has somewhere to leave: the sole pane of a tab
  // already is its own tab, and a slot that did nothing would still read as an
  // invitation.
  const canExtractDraggedPane =
    draggedPaneId != null &&
    terminalTabs.some((tab) => {
      const leaves = collectLeafIds(tab.root);
      return leaves.length > 1 && leaves.includes(draggedPaneId);
    });

  const handleNewTab = () => void openTerminalTab();

  const handleSplit = (
    tabId: string,
    targetTerminalId: string,
    direction: SplitDirection,
  ) => {
    void splitTerminal(tabId, targetTerminalId, direction);
  };

  /** Split the active tab's focused pane; with no tab open, start one. */
  const handleSplitActive = (direction: SplitDirection) => {
    if (!activeTab) {
      handleNewTab();
      return;
    }
    handleSplit(activeTab.id, activeTab.focused, direction);
  };

  const handleClosePane = (id: string) => {
    void closeTerminalPane(id);
  };

  const handleCloseTab = (tab: TerminalTab) => {
    void closeTerminalTab(tab);
  };

  return (
    // The card *is* the terminal surface — panes don't re-declare a background
    // or a rounding of their own, so there's one edge between diff and shell.
    <div className="panel-card flex h-full w-full flex-col overflow-hidden bg-surface-inset">
      {/* Tab strip */}
      {/* Controls stay on the first row (items-start) while the tabs below them
          wrap — the strip grows downward instead of scrolling sideways. */}
      {/* select-none: the strip is drag-and-click chrome, and a tab title left
          highlighted after a drag reads as a selection you didn't make. */}
      <div className="flex select-none items-start gap-0.5 border-b border-edge/60 px-1.5 py-1">
        {/* Tabs wrap rather than scroll: the panel is often half the window
            wide, where a horizontal scroller hides tabs behind a gesture you
            have to discover. Capped at ~three rows so a pile of terminals can't
            eat the panel; past that the rows scroll. */}
        <div
          className="flex max-h-[4.75rem] flex-1 flex-wrap items-center gap-0.5
                     overflow-y-auto scrollbar-thin"
        >
          {terminalTabs.map((tab, index) => {
            const { leafIds, severity, allDead, title, primaryId } = tabGlance(
              tab,
              terminalSessions,
              terminalStatuses,
              terminalExited,
            );
            const focusedSession = terminalSessions[tab.focused];
            const isActive = tab.id === activeTabId;
            const isDropTarget =
              draggedTab !== null &&
              draggedTab.index !== index &&
              tabDropTarget?.kind === "tab-reorder" &&
              tabDropTarget.index === index;
            // A pane already in this tab has nothing to gain from being dropped
            // on it — declining the dragover is also what stops the browser
            // from firing a drop we'd have to ignore.
            const takesPane =
              draggedPaneId != null && !leafIds.includes(draggedPaneId);
            // Its directory is gone but the shell is still alive — say so, so
            // it isn't mistaken for a terminal in a worktree that still exists.
            const orphaned =
              focusedSession != null &&
              isOrphanedSession(
                terminalCheckouts,
                focusedSession.repoPath,
                focusedSession.cwd,
              );
            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    draggable
                    // Hit-tested by useTerminalFileDrop under Tauri, where the
                    // dragover/drop below never fire: which tab this is, where it
                    // sits in the strip, and which panes it already holds.
                    data-strip-tab={tab.id}
                    data-strip-index={index}
                    data-strip-leaves={leafIds.join(" ")}
                    onDragStart={(e) => {
                      // Latched in the module rather than component state: under
                      // Tauri the drop arrives on the window after our own dragend,
                      // and dataTransfer is unreadable there.
                      setDraggedTab({ tabId: tab.id, index });
                      e.dataTransfer.effectAllowed = "move";
                      // A payload is required for the drag to start at all.
                      e.dataTransfer.setData("text/plain", tab.id);
                      // The same drag reaches the sidebar, where dropping on a work
                      // card claims the tab. Its own type, because a card has to
                      // decide during dragover — when only `types` is readable —
                      // whether this is a drag it should take.
                      e.dataTransfer.setData(TERMINAL_TAB_MIME, tab.id);
                    }}
                    onDragOver={(e) => {
                      if (takesPane) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        setTabDropTarget({
                          kind: "pane-into-tab",
                          tabId: tab.id,
                        });
                        return;
                      }
                      // Only claim the drop for our own tab drags; anything else
                      // (a file from Finder) falls through to its own handler.
                      if (draggedTabSource() === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setTabDropTarget({ kind: "tab-reorder", index });
                    }}
                    onDragLeave={(e) => {
                      if (!pointerLeft(e)) return;
                      clearTabDropTarget({
                        kind: "pane-into-tab",
                        tabId: tab.id,
                      });
                    }}
                    onDrop={(e) => {
                      const pane = e.dataTransfer.getData(TERMINAL_PANE_MIME);
                      if (pane) {
                        e.preventDefault();
                        e.stopPropagation();
                        setTabDropTarget(null);
                        movePaneToTab(pane, tab.id);
                        return;
                      }
                      const source = draggedTabSource();
                      if (source === null) return;
                      e.preventDefault();
                      moveTab(source.index, index);
                      setDraggedTab(null);
                    }}
                    onDragEnd={() => {
                      setDraggedTab(null);
                      setTabDropTarget(null);
                    }}
                    className={clsx(
                      "group relative flex max-w-full shrink-0 items-center rounded-md px-2 py-1 text-xs",
                      // Lifted off the terminal surface, not recessed into it —
                      // the strip now sits on surface-inset itself.
                      isActive
                        ? "bg-surface-raised text-fg-secondary"
                        : "text-fg-muted hover:bg-fg/[0.06]",
                      draggedTab?.index === index && "opacity-50",
                      takesPane &&
                        tabDropTarget?.kind === "pane-into-tab" &&
                        tabDropTarget.tabId === tab.id &&
                        DROP_RING,
                    )}
                  >
                    {isDropTarget && (
                      <span
                        className={clsx(
                          "pointer-events-none absolute inset-y-0.5 w-0.5 rounded-full bg-focus-ring",
                          // Mark the edge the tab would land against.
                          draggedTab !== null && draggedTab.index < index
                            ? "right-0"
                            : "left-0",
                        )}
                      />
                    )}
                    <TabHoverPeek sessionId={allDead ? null : primaryId}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab(tab.id);
                          // Picking a tab is leaving the overview — otherwise the
                          // click looks eaten, since the grid stays on top.
                          if (overviewOpen) setTerminalOverviewOpen(false);
                        }}
                        title={allDead ? title : undefined}
                        className="flex min-w-0 items-center gap-1.5"
                      >
                        <PhaseDot phase={severity ?? "idle"} dead={allDead} />
                        <span className="max-w-[12rem] truncate">{title}</span>
                        {orphaned && (
                          <span
                            title={`${basename(
                              focusedSession?.cwd ?? "",
                            )} no longer exists — this shell is still running in a deleted directory`}
                            aria-label="Directory no longer exists"
                            className="shrink-0 text-status-rejected"
                          >
                            <WarningIcon className="h-3 w-3" />
                          </span>
                        )}
                        {leafIds.length > 1 && (
                          <span className="text-xxs text-fg-faint tabular-nums">
                            {leafIds.length}
                          </span>
                        )}
                      </button>
                    </TabHoverPeek>
                    {/* Out of flow, so a tab is no wider for having controls and
                    doesn't jump when they appear. They fade in over the
                    trailing edge, carrying the tab's own background as a
                    gradient so a long title reads under them rather than
                    through them. */}
                    <div
                      className={clsx(
                        "absolute inset-y-0 right-0 flex items-center justify-end gap-0.5 rounded-r-md pr-1.5 pl-3",
                        "bg-gradient-to-l to-transparent opacity-0 transition-opacity",
                        // Invisible means inert: at rest this strip must not eat
                        // clicks meant for the tab it's sitting on top of.
                        "pointer-events-none group-hover:pointer-events-auto",
                        "text-fg-faint group-hover:opacity-100",
                        isActive
                          ? "from-surface-raised via-surface-raised"
                          : "from-surface-inset via-surface-inset",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleCloseTab(tab)}
                        aria-label="Close tab"
                        className="hover:text-fg-secondary"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </ContextMenuTrigger>
                {/* The same menu the sidebar rows carry — a tab is a terminal
                    the panel happens to be showing, and every one of its panes
                    is claimed, jumped to or killed together. */}
                <ContextMenuContent>
                  <TerminalMenuItems sessionIds={leafIds} />
                </ContextMenuContent>
              </ContextMenu>
            );
          })}

          {/* Only while a pane with siblings is in flight — a drop target for
              something that isn't being dragged is just clutter in a strip that
              already wraps. */}
          {canExtractDraggedPane && (
            <div
              // Hit-tested by useTerminalFileDrop under Tauri.
              data-strip-new-tab=""
              onDragOver={(e) => {
                // Claimed by MIME like every other target here, rather than by
                // trusting that the slot only exists during a pane drag — that
                // is a render-time fact, and this is the handler that would
                // silently swallow an unrelated drag if it ever stopped being
                // true.
                if (!e.dataTransfer.types.includes(TERMINAL_PANE_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                setTabDropTarget({ kind: "new-tab" });
              }}
              onDragLeave={(e) => {
                if (pointerLeft(e)) clearTabDropTarget({ kind: "new-tab" });
              }}
              onDrop={(e) => {
                setTabDropTarget(null);
                const pane = e.dataTransfer.getData(TERMINAL_PANE_MIME);
                if (!pane) return;
                e.preventDefault();
                e.stopPropagation();
                movePaneToNewTab(pane);
              }}
              className={clsx(
                "flex shrink-0 items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs",
                tabDropTarget?.kind === "new-tab"
                  ? "border-focus-ring bg-fg/[0.06] text-fg-secondary"
                  : "border-edge text-fg-faint",
              )}
            >
              <span className="text-sm leading-none">+</span>
              <span>New tab</span>
            </div>
          )}
        </div>

        {/* New terminal: the button splits, the caret offers the rest. */}
        <div className="ml-1 flex shrink-0 items-center rounded text-fg-muted hover:bg-fg/[0.06]">
          <button
            type="button"
            aria-label={activeTab ? "Split terminal" : "New terminal"}
            title={activeTab ? "Split terminal (⌘D)" : "New terminal"}
            onClick={() => handleSplitActive("row")}
            className="rounded-l py-1 pl-2 pr-1 text-sm hover:text-fg-secondary"
          >
            +
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="New terminal options"
                className="rounded-r py-1 pl-0.5 pr-1.5 hover:text-fg-secondary"
              >
                <CaretIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // Radix restores focus to the trigger when the menu closes, and
              // it does so after the exit animation — landing *after* the new
              // pane focused itself. Let the terminal keep the focus.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem onClick={handleNewTab}>
                New tab
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSplitActive("row")}>
                Split vertical
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSplitActive("column")}>
                Split horizontal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Panel controls: overview / dock side / maximize / minimize */}
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          <PaneButton
            label="All terminals (⇧⌘`)"
            onClick={toggleTerminalOverview}
            pressed={overviewOpen}
          >
            <OverviewIcon />
          </PaneButton>

          <PaneButton
            label={`Move terminal to ${
              terminalDockSide === "left" ? "right" : "left"
            }`}
            onClick={toggleTerminalDockSide}
          >
            <DockSideIcon side={terminalDockSide} />
          </PaneButton>

          <PaneButton
            label={maximized ? "Show diff (⇧⌘↵)" : "Expand over diff (⇧⌘↵)"}
            onClick={toggleTerminalPanelMaximized}
            pressed={maximized}
          >
            <MaximizeIcon maximized={maximized} side={terminalDockSide} />
          </PaneButton>

          <PaneButton label="Hide terminal (⌘`)" onClick={toggleTerminalPanel}>
            <MinimizeIcon side={terminalDockSide} />
          </PaneButton>
        </div>
      </div>

      {/* Tabs — all mounted, inactive ones hidden to keep xterms streaming.
          The panes own the only inner gutter, so nothing is inset here. */}
      <div className="relative flex-1 overflow-hidden">
        {terminalTabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-fg-faint">
            No terminals — use + to start one.
          </div>
        ) : (
          terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className={clsx(
                "absolute inset-0",
                tab.id === activeTabId ? "" : "hidden",
              )}
            >
              <PaneTree
                node={tab.root}
                path={[]}
                // Folding the last pane still showing is declined, so the tab
                // stops offering it rather than offering a button that no-ops.
                canFold={expandedLeafIds(tab.root).length > 1}
                tabId={tab.id}
                focusedId={tab.focused}
                tabActive={tab.id === activeTabId}
                onFocus={(id) => setFocusedTerminalPane(tab.id, id)}
                onSplit={(id, direction) => handleSplit(tab.id, id, direction)}
                onClose={handleClosePane}
              />
            </div>
          ))
        )}
        {/* Overlaid rather than swapped in, so every xterm stays mounted and
            streaming underneath — leaving the overview costs nothing. */}
        {overviewOpen && <TerminalOverview />}
      </div>
    </div>
  );
}

/**
 * The live peek a tab shows on hover — what the shell's screen says right now,
 * without clicking over to it. No card for a dead tab (`sessionId: null`);
 * its title attribute answers instead.
 */
function TabHoverPeek({
  sessionId,
  children,
}: {
  sessionId: string | null;
  children: ReactElement;
}): ReactNode {
  if (!sessionId) return children;
  return (
    <SimpleTooltip
      side="bottom"
      contentClassName={RICH_TOOLTIP_CLASS}
      content={<TerminalGlanceCard sessionId={sessionId} />}
    >
      {children}
    </SimpleTooltip>
  );
}

/** Overview glyph: a grid of terminal cards. */
function OverviewIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="5.25" height="4.75" rx="1" />
      <rect x="8.75" y="2.5" width="5.25" height="4.75" rx="1" />
      <rect x="2" y="8.75" width="5.25" height="4.75" rx="1" />
      <rect x="8.75" y="8.75" width="5.25" height="4.75" rx="1" />
    </svg>
  );
}

/** Caret opening the new-terminal menu beside the split button. */
function CaretIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6.5 8 10.5l4-4" />
    </svg>
  );
}

/**
 * Maximize glyph: arrows pushing outward (expand over the diff) or inward
 * (restore the split), pointing along the dock axis.
 */
function MaximizeIcon({
  maximized,
  side,
}: {
  maximized: boolean;
  side: "left" | "right";
}): ReactNode {
  // Mirror so the arrows always point toward the diff being covered/revealed.
  const flip = side === "right";
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 ${flip ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      {maximized ? (
        <>
          <path d="M10.5 5.5 8 8l2.5 2.5" />
          <line x1="12.5" y1="4" x2="12.5" y2="12" />
        </>
      ) : (
        <>
          <path d="M6 5.5 8.5 8 6 10.5" />
          <line x1="3.5" y1="4" x2="3.5" y2="12" />
        </>
      )}
    </svg>
  );
}

/** Minimize glyph: a chevron collapsing the panel toward its dock edge. */
function MinimizeIcon({ side }: { side: "left" | "right" }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 ${side === "right" ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4 5 8l4 4" />
      <line x1="12" y1="3.5" x2="12" y2="12.5" />
    </svg>
  );
}

/** Panel-dock glyph: a frame with the filled bar on the terminal's current side. */
function DockSideIcon({ side }: { side: "left" | "right" }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <rect
        x={side === "left" ? 2 : 10}
        y="2.5"
        width="4"
        height="11"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
