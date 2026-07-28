import { type ReactNode, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  isOrphanedSession,
  mergeVisibleTabs,
  panelReviewKey,
  terminalSeverity,
  type TerminalTab,
} from "../../stores/slices/terminalSlice";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { useTerminalFileDrop } from "../../hooks/useTerminalFileDrop";
import { phaseDotClass, basename } from "../TabRail/terminal-status-format";
import { collectLeafIds, type SplitDirection } from "./pane-tree";
import { closeTerminalPane, closeTerminalTab } from "./close";
import { PaneTree, PaneButton } from "./PaneTree";
import { PinIcon, WarningIcon } from "../ui/icons";
import type { TerminalStatus } from "../../types";

export function TerminalPanel(): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const terminalCheckouts = useReviewStore((s) => s.terminalCheckouts);
  const terminalTabsByReviewKey = useReviewStore(
    (s) => s.terminalTabsByReviewKey,
  );
  const activeTabIdByReviewKey = useReviewStore(
    (s) => s.activeTabIdByReviewKey,
  );
  const reviewTier = useReviewStore((s) => s.reviewTier);
  const ensureMaterialized = useReviewStore((s) => s.ensureMaterialized);

  const startTerminal = useReviewStore((s) => s.startTerminal);
  const splitTerminal = useReviewStore((s) => s.splitTerminal);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);
  const moveTab = useReviewStore((s) => s.moveTab);
  const toggleTabPinned = useReviewStore((s) => s.toggleTabPinned);
  const setFocusedTerminalPane = useReviewStore(
    (s) => s.setFocusedTerminalPane,
  );
  const terminalDockSide = useReviewStore((s) => s.terminalDockSide);
  const toggleTerminalDockSide = useReviewStore(
    (s) => s.toggleTerminalDockSide,
  );
  const maximized = useReviewStore((s) => s.terminalPanelMode === "maximized");
  const toggleTerminalPanelMaximized = useReviewStore(
    (s) => s.toggleTerminalPanelMaximized,
  );
  const toggleTerminalPanel = useReviewStore((s) => s.toggleTerminalPanel);

  useTerminalFileDrop();

  // Tab drag-to-reorder. Both indices are local to this drag — `dragIndex`
  // doubles as "this is our own tab drag", so a file dragged in from the OS
  // (handled by useTerminalFileDrop, a separate channel) is never treated as a
  // reorder.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const reviewKey = repoPath
    ? panelReviewKey(terminalCheckouts, repoPath, reviewRef)
    : "";

  // What the strip shows: this review's own tabs, plus every pinned tab from
  // anywhere. Each entry carries the key that *owns* the tab, which is not the
  // key we're viewing when the tab is a pinned visitor — every store call about
  // a tab has to use its home key or the tab would silently change address.
  const visibleTabs = useMemo(
    () =>
      reviewKey ? mergeVisibleTabs(terminalTabsByReviewKey, reviewKey) : [],
    [reviewKey, terminalTabsByReviewKey],
  );
  const activeTabId =
    activeTabIdByReviewKey[reviewKey] ?? visibleTabs[0]?.tab.id ?? null;

  // ⌘D / ⇧⌘D pane splits are dispatched by useKeyboardNavigation, which routes
  // the chord to whichever pane has focus.

  const activeTab =
    visibleTabs.find((v) => v.tab.id === activeTabId)?.tab ?? null;

  if (!repoPath) return null;

  /**
   * Open a terminal in a new tab, in the directory this review is about: its
   * own checkout. There's no cwd picker — a shell that landed somewhere else
   * than you wanted is one `cd` away.
   */
  const handleNewTab = () => {
    const worktree =
      reviewTier?.tier === "materialized" ? reviewTier.worktreePath : null;
    if (worktree) {
      void startTerminal(reviewKey, repoPath, worktree, 80, 24);
      return;
    }
    // No review open (or a repo-level view) — the repo root is the only
    // directory there is.
    if (!reviewRef) {
      void startTerminal(reviewKey, repoPath, repoPath, 80, 24);
      return;
    }
    // This review has no checkout yet. Materializing asks first, so a declined
    // prompt simply starts no terminal.
    void ensureMaterialized("run a terminal in it").then((worktreePath) => {
      if (worktreePath) {
        void startTerminal(reviewKey, repoPath, worktreePath, 80, 24);
      }
    });
  };

  const handleSplit = (
    homeKey: string,
    tabId: string,
    targetTerminalId: string,
    direction: SplitDirection,
  ) => {
    void splitTerminal(homeKey, tabId, targetTerminalId, direction);
  };

  /** Split the active tab's focused pane; with no tab open, start one. */
  const handleSplitActive = (direction: SplitDirection) => {
    const active = visibleTabs.find((v) => v.tab.id === activeTabId);
    if (!active) {
      handleNewTab();
      return;
    }
    handleSplit(active.reviewKey, active.tab.id, active.tab.focused, direction);
  };

  /**
   * Drag-to-reorder within the strip. Only tabs sharing a home can trade
   * places: the order lives per bucket, so dragging a pinned visitor past a
   * local tab has no order to write.
   */
  const reorderVisibleTabs = (from: number, to: number) => {
    const source = visibleTabs[from];
    const target = visibleTabs[to];
    if (!source || !target || source.reviewKey !== target.reviewKey) return;
    const bucket = terminalTabsByReviewKey[source.reviewKey] ?? [];
    moveTab(
      source.reviewKey,
      bucket.findIndex((t) => t.id === source.tab.id),
      bucket.findIndex((t) => t.id === target.tab.id),
    );
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
      <div className="flex items-center gap-0.5 border-b border-edge/60 px-1.5 py-1">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {visibleTabs.map(({ tab }, index) => {
            const leafIds = collectLeafIds(tab.root);
            const leafStatuses = leafIds
              .map((id) => terminalStatuses[id])
              .filter((s): s is TerminalStatus => s != null);
            const severity = terminalSeverity(leafStatuses);
            const allDead = leafIds.every((id) => id in terminalExited);
            const focusedSession = terminalSessions[tab.focused];
            const focusedStatus = terminalStatuses[tab.focused];
            const title =
              focusedStatus?.title ||
              focusedSession?.title ||
              basename(focusedSession?.cwd ?? "") ||
              "shell";
            const isActive = tab.id === activeTabId;
            const isDropTarget =
              dragIndex !== null && dragIndex !== index && dropIndex === index;
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
              <div
                key={tab.id}
                draggable
                onDragStart={(e) => {
                  setDragIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                  // A payload is required for the drag to start at all.
                  e.dataTransfer.setData("text/plain", tab.id);
                }}
                onDragOver={(e) => {
                  // Only claim the drop for our own tab drags; anything else
                  // (a file from Finder) falls through to its own handler.
                  if (dragIndex === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropIndex(index);
                }}
                onDrop={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  reorderVisibleTabs(dragIndex, index);
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                className={clsx(
                  "group relative flex shrink-0 items-center rounded-md px-2 py-1 text-xs",
                  // Lifted off the terminal surface, not recessed into it —
                  // the strip now sits on surface-inset itself.
                  isActive
                    ? "bg-surface-raised text-fg-secondary"
                    : "text-fg-muted hover:bg-fg/[0.06]",
                  dragIndex === index && "opacity-50",
                )}
              >
                {isDropTarget && (
                  <span
                    className={clsx(
                      "pointer-events-none absolute inset-y-0.5 w-0.5 rounded-full bg-focus-ring",
                      // Mark the edge the tab would land against.
                      dragIndex < index ? "right-0" : "left-0",
                    )}
                  />
                )}
                {/* A pinned tab wears its marker at rest — it is the only
                    thing distinguishing a visitor from a local tab — and the
                    marker is the control that takes it off again. */}
                {tab.pinned && (
                  <button
                    type="button"
                    onClick={() => toggleTabPinned(tab.id)}
                    aria-label="Unpin tab"
                    title="Unpin — show only in its own repo"
                    aria-pressed
                    className="mr-1 shrink-0 text-fg-muted hover:text-fg-secondary"
                  >
                    <PinIcon className="h-2.5 w-2.5" filled />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab(reviewKey, tab.id)}
                  className="flex items-center gap-1.5"
                >
                  <span
                    className={clsx(
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                      allDead
                        ? "bg-fg-faint"
                        : phaseDotClass(severity ?? "idle"),
                    )}
                  />
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
                  {/* Only offered here while unpinned — once pinned, the
                      marker beside the title is the control. */}
                  {!tab.pinned && (
                    <button
                      type="button"
                      onClick={() => toggleTabPinned(tab.id)}
                      aria-label="Pin tab"
                      title="Pin — keep visible in every repo"
                      aria-pressed={false}
                      className="hover:text-fg-secondary"
                    >
                      <PinIcon className="h-3 w-3" />
                    </button>
                  )}
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
            );
          })}
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

        {/* Panel controls: dock side / maximize / minimize */}
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
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
        {visibleTabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-fg-faint">
            No terminals — use + to start one.
          </div>
        ) : (
          visibleTabs.map(({ tab, reviewKey: homeKey }) => (
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
                // The tab's own key, not the one we're viewing: focus and split
                // sizes are stored where the tab lives.
                reviewKey={homeKey}
                tabId={tab.id}
                focusedId={tab.focused}
                tabActive={tab.id === activeTabId}
                onFocus={(id) => setFocusedTerminalPane(homeKey, tab.id, id)}
                onSplit={(id, direction) =>
                  handleSplit(homeKey, tab.id, id, direction)
                }
                onClose={handleClosePane}
              />
            </div>
          ))
        )}
      </div>
    </div>
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
