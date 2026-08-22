import { type ReactElement, type ReactNode, useMemo } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { CompactMenuButton } from "../Stage/CompactNav";
import {
  isOrphanedSession,
  type TerminalTab,
} from "../../stores/slices/terminalSlice";
import { useFocusedWorkspace } from "../../stores/selectors/workspaces";
import { useIsCompact } from "../../hooks/useIsCompact";
import { useIsTouchPrimary } from "../../hooks/useIsTouchPrimary";
import { useWorkspaceTabs } from "../../stores/selectors/terminals";
import { basename } from "../Sidebar/terminal-status-format";
import { PhaseDot } from "../Sidebar/PhaseDot";
import { RICH_TOOLTIP_CLASS, SimpleTooltip } from "../ui/tooltip";
import { tabGlance } from "./glance";
import { TerminalGlanceCard } from "./TerminalGlanceCard";
import { collectLeafIds, expandedLeafIds } from "./pane-tree";
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
import { StartTerminal } from "./StartTerminal";
import { SoftKeys } from "./SoftKeys";
import { TerminalTextSize } from "./TerminalTextSize";
import { PaneTree } from "./PaneTree";
import { FocusToggle } from "../Stage/FocusToggle";
import { WarningIcon } from "../ui/icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { TerminalMenuItems } from "../Sidebar/ActionMenu";

export function TerminalPanel(): ReactNode {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const terminalCheckouts = useReviewStore((s) => s.terminalCheckouts);
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const activeTabId = useReviewStore((s) => s.activeTabId);

  const setActiveTab = useReviewStore((s) => s.setActiveTab);
  const moveTab = useReviewStore((s) => s.moveTab);
  const setFocusedTerminalPane = useReviewStore(
    (s) => s.setFocusedTerminalPane,
  );
  const movePaneToTab = useReviewStore((s) => s.movePaneToTab);
  const movePaneToNewTab = useReviewStore((s) => s.movePaneToNewTab);

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

  // The strip is this workspace's terminals and nothing else — a tab belongs
  // to exactly one workspace, and the stage is a zoom into one of them. Every
  // tab still *renders* below, hidden, because unmounting an xterm to switch
  // workspaces would throw away its screen.
  const focusedWorkspace = useFocusedWorkspace();
  const stripTabs = useWorkspaceTabs(focusedWorkspace?.id ?? null);
  const compact = useIsCompact();
  // Two questions, deliberately not one: the text-size steps are a width fact
  // (the desktop has a settings panel for them), while the keys are a device
  // fact — an iPad in landscape is wide and still has no Escape key.
  const touchPrimary = useIsTouchPrimary();
  // A tab's position in the *whole* strip, which is what a reorder moves and
  // what `data-strip-index` has to carry. Built once rather than an `indexOf`
  // per rendered tab.
  const indexOfTab = useMemo(
    () => new Map(terminalTabs.map((tab, index) => [tab.id, index])),
    [terminalTabs],
  );

  const activeTab = terminalTabs.find((tab) => tab.id === activeTabId) ?? null;
  // Nothing of this workspace is on screen when the active tab is another
  // workspace's — which happens for the moment between focusing a workspace
  // and its own tab being selected.
  const showingTabId =
    activeTab && stripTabs.some((tab) => tab.id === activeTab.id)
      ? activeTab.id
      : null;
  // The pane the key bar types into: whichever one the showing tab has focused.
  const showingPaneId = showingTabId ? (activeTab?.focused ?? null) : null;

  // Offered only for a pane that has somewhere to leave: the sole pane of a tab
  // already is its own tab, and a slot that did nothing would still read as an
  // invitation.
  const canExtractDraggedPane =
    draggedPaneId != null &&
    terminalTabs.some((tab) => {
      const leaves = collectLeafIds(tab.root);
      return leaves.length > 1 && leaves.includes(draggedPaneId);
    });

  // Started *in* the workspace the stage is showing, so the "+" beside its own
  // tabs can't hand it to another one.
  const handleNewTab = () => void openTerminalTab(focusedWorkspace);

  const handleClosePane = (id: string) => {
    void closeTerminalPane(id);
  };

  const handleCloseTab = (tab: TerminalTab) => {
    void closeTerminalTab(tab);
  };

  return (
    // The card *is* the terminal surface — panes don't re-declare a background
    // or a rounding of their own, so there's one edge between diff and shell.
    <div
      // The whole panel, chrome included, is what ⌘W asks about when no pane
      // holds the keyboard (see Terminal/close.ts). Clicking a tab or the "+"
      // is not leaving the terminal, and only this boundary can say so — a
      // pane's own `data-terminal-id` stops at the pane.
      data-terminal-panel=""
      className="panel-card flex h-full w-full flex-col overflow-hidden bg-surface-inset"
    >
      {/* Tab strip */}
      {/* One row, so the controls simply sit on it. */}
      {/* select-none: the strip is drag-and-click chrome, and a tab title left
          highlighted after a drag reads as a selection you didn't make. */}
      <div className="group/bar flex select-none items-center gap-0.5 border-b border-edge/60 px-1.5 py-1">
        {/* Phone only: the way out to the workspace queue. Renders nothing at
            desktop width, where that queue is a column already on screen. */}
        <CompactMenuButton />
        {/* One row, browser-style: the tabs divide the strip between them and
            shrink as more arrive, rather than wrapping onto new rows. Wrapping
            made the strip grow downward and take height from the terminal
            itself — with a few shells open, a third of a short panel was tab
            chrome. Each tab keeps a floor wide enough for its marker and a few
            characters; past the point where they all fit at that floor the row
            scrolls, which is the same bargain every browser makes. */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-thin">
          {stripTabs.map((tab) => {
            // The strip shows one workspace's tabs, but a reorder moves a tab
            // within the whole list — so the index that travels with the drag
            // (and lands in `data-strip-index`, which the Tauri drop path
            // reads) is the tab's position in `terminalTabs`, not in the strip.
            const index = indexOfTab.get(tab.id) ?? 0;
            const { leafIds, severity, allDead, title, primaryId, agent } =
              tabGlance(
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
                      `group relative flex min-w-[5.5rem] max-w-[13rem] flex-1
                       basis-0 items-center rounded-md px-2 py-1 text-xs`,
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
                        onClick={() => setActiveTab(tab.id)}
                        title={allDead ? title : undefined}
                        className="flex min-w-0 items-center gap-1.5"
                      >
                        <PhaseDot
                          phase={severity ?? "idle"}
                          dead={allDead}
                          agent={agent}
                        />
                        <span className="truncate">{title}</span>
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

          {/* New terminal, in the strip itself rather than pinned past its
              right edge — the mirror of the repo strip's `+`, which sits after
              the last repo tab. One verb, no menu: splitting is a gesture on
              the pane you want to split (⌘D), not a choice made before there is
              anything to split. */}
          <button
            type="button"
            aria-label="New terminal tab"
            title="New terminal tab (⌘T)"
            onClick={handleNewTab}
            className="shrink-0 rounded-md px-2 py-1 text-sm leading-none text-fg-muted
                       hover:bg-fg/[0.06] hover:text-fg-secondary"
          >
            +
          </button>
        </div>

        {/* This half's own focus toggle, at the far end — and, on a phone,
            the text-size steps that have no settings panel to live in. */}
        <div className="ml-2 flex shrink-0 items-center">
          {compact && showingPaneId && (
            <TerminalTextSize paneId={showingPaneId} />
          )}
          <FocusToggle half="terminal" />
        </div>
      </div>

      {/* Tabs — all mounted, inactive ones hidden to keep xterms streaming.
          The panes own the only inner gutter, so nothing is inset here. */}
      <div className="relative flex-1 overflow-hidden">
        {stripTabs.length === 0 ? (
          <StartTerminal workspace={focusedWorkspace} />
        ) : (
          terminalTabs.map((tab) => (
            <div
              key={tab.id}
              className={clsx(
                "absolute inset-0",
                tab.id === showingTabId ? "" : "hidden",
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
                tabActive={tab.id === showingTabId}
                onFocus={(id) => setFocusedTerminalPane(tab.id, id)}
                onClose={handleClosePane}
              />
            </div>
          ))
        )}
      </div>

      {/* The keys a software keyboard doesn't have, for the pane on screen. */}
      {touchPrimary && showingPaneId && <SoftKeys terminalId={showingPaneId} />}
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
