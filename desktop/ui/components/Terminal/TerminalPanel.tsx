import { type ReactNode, useMemo } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { makeReviewKey } from "../../utils/review-key";
import {
  terminalSeverity,
  type TerminalTab,
} from "../../stores/slices/terminalSlice";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "../ui/dropdown-menu";
import { useTerminalFileDrop } from "../../hooks/useTerminalFileDrop";
import { useSidebarTree } from "../../hooks/useSidebarTree";
import { phaseDotClass, basename } from "../TabRail/terminal-status-format";
import { disposeTerminal } from "./registry";
import { collectLeafIds, type SplitDirection } from "./pane-tree";
import { PaneTree, PaneButton } from "./PaneTree";
import type { TerminalStatus } from "../../types";

interface CwdOption {
  label: string;
  /** Null when the row has no checkout yet — picking it materializes one. */
  cwd: string | null;
  /** Extra line shown under the label, e.g. the cost of materializing. */
  hint?: string;
}

export function TerminalPanel(): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const terminalTabsByReviewKey = useReviewStore(
    (s) => s.terminalTabsByReviewKey,
  );
  const activeTabIdByReviewKey = useReviewStore(
    (s) => s.activeTabIdByReviewKey,
  );
  const tree = useSidebarTree();
  const reviewTier = useReviewStore((s) => s.reviewTier);
  const ensureMaterialized = useReviewStore((s) => s.ensureMaterialized);

  const startTerminal = useReviewStore((s) => s.startTerminal);
  const splitTerminal = useReviewStore((s) => s.splitTerminal);
  const killTerminal = useReviewStore((s) => s.killTerminal);
  const removeTerminal = useReviewStore((s) => s.removeTerminal);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);
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

  const reviewKey = repoPath ? makeReviewKey(repoPath, reviewRef ?? "") : "";

  const tabs = useMemo<TerminalTab[]>(
    () => (reviewKey ? (terminalTabsByReviewKey[reviewKey] ?? []) : []),
    [reviewKey, terminalTabsByReviewKey],
  );
  const activeTabId = activeTabIdByReviewKey[reviewKey] ?? tabs[0]?.id ?? null;

  // ⌘D / ⇧⌘D pane splits are dispatched by useKeyboardNavigation, which routes
  // the chord to whichever pane has focus.

  // cwd choices for the "+" menu. This review leads — a terminal opened from
  // here belongs to the thing being reviewed, so the row's own checkout is the
  // default even when it doesn't exist yet. The repo's other checkouts follow,
  // for the times you want to step outside it.
  //
  // Every option comes from a sidebar row's `checkoutPath`, so a directory can
  // only appear once and it appears under the branch that owns it. Deriving the
  // list here independently is what once produced "master (checks out a
  // worktree)" sitting above "Repo root" — two entries for one directory.
  const cwdOptions = useMemo<CwdOption[]>(() => {
    if (!repoPath) return [];
    const options: CwdOption[] = [];
    const seen = new Set<string>();

    const push = (label: string, cwd: string) => {
      if (seen.has(cwd)) return;
      seen.add(cwd);
      options.push({
        label,
        cwd,
        hint: cwd === repoPath ? "repo root" : undefined,
      });
    };

    const reviewWorktree =
      reviewTier?.tier === "materialized" ? reviewTier.worktreePath : undefined;
    if (reviewRef && reviewWorktree) {
      push(reviewRef, reviewWorktree);
    } else if (reviewRef) {
      options.push({
        label: reviewRef,
        cwd: null,
        hint: "checks out a worktree",
      });
    }

    const node = tree.find((n) => n.repoPath === repoPath);
    for (const row of [
      node?.head,
      ...(node?.live ?? []),
      ...(node?.rest ?? []),
    ]) {
      if (row?.checkoutPath)
        push(row.ref || basename(row.checkoutPath), row.checkoutPath);
    }

    // A repo whose HEAD is detached (or that has no rows yet) still has a root
    // worth opening a terminal in.
    push("Repo root", repoPath);

    return options;
  }, [repoPath, reviewRef, reviewTier, tree]);

  if (!repoPath) return null;

  const handleNewTerminal = (option: CwdOption) => {
    // A null cwd means this review has no checkout yet. Materializing asks
    // first, so a declined prompt simply starts no terminal.
    if (option.cwd === null) {
      void ensureMaterialized("run a terminal in it").then((worktreePath) => {
        if (worktreePath) {
          void startTerminal(reviewKey, repoPath, worktreePath, 80, 24);
        }
      });
      return;
    }
    void startTerminal(reviewKey, repoPath, option.cwd, 80, 24);
  };

  const handleSplit = (
    tabId: string,
    targetTerminalId: string,
    direction: SplitDirection,
  ) => {
    void splitTerminal(reviewKey, tabId, targetTerminalId, direction);
  };

  const handleClosePane = (id: string) => {
    // Update store state first so the pane unmounts (and unsubscribes from
    // output), THEN dispose the xterm — deferred to the next macrotask so the
    // React unmount has committed. Disposing synchronously here would tear down
    // the terminal while the pane is still mounted and PTY output could still
    // arrive at it (the pane's write is also guarded, defense in depth).
    const scheduleDispose = () => setTimeout(() => disposeTerminal(id), 0);
    const isDead = id in terminalExited;
    if (isDead) {
      removeTerminal(id);
      scheduleDispose();
    } else {
      void killTerminal(id).finally(scheduleDispose);
    }
  };

  const handleCloseTab = (tab: TerminalTab) => {
    for (const id of collectLeafIds(tab.root)) handleClosePane(id);
  };

  return (
    // The card *is* the terminal surface — panes don't re-declare a background
    // or a rounding of their own, so there's one edge between diff and shell.
    <div className="panel-card flex h-full w-full flex-col overflow-hidden bg-surface-inset">
      {/* Tab strip */}
      <div className="flex items-center gap-0.5 border-b border-edge/60 px-1.5 py-1">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
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
            return (
              <div
                key={tab.id}
                className={clsx(
                  "group flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs",
                  // Lifted off the terminal surface, not recessed into it —
                  // the strip now sits on surface-inset itself.
                  isActive
                    ? "bg-surface-raised text-fg-secondary"
                    : "text-fg-muted hover:bg-fg/[0.06]",
                )}
              >
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
                  {leafIds.length > 1 && (
                    <span className="text-xxs text-fg-faint tabular-nums">
                      {leafIds.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleCloseTab(tab)}
                  aria-label="Close tab"
                  className="rounded px-0.5 text-fg-faint opacity-0 transition-opacity
                             hover:text-fg-secondary group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* "+" new-tab menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="New terminal"
              className="shrink-0 rounded px-2 py-1 text-sm text-fg-muted
                         hover:bg-fg/[0.06] hover:text-fg-secondary"
            >
              +
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>New terminal in…</DropdownMenuLabel>
            {cwdOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.cwd ?? `materialize:${opt.label}`}
                onClick={() => handleNewTerminal(opt)}
              >
                <span className="min-w-0 truncate">{opt.label}</span>
                {opt.hint && (
                  <span className="ml-2 shrink-0 text-xxs text-fg-faint">
                    {opt.hint}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
        {tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-fg-faint">
            No terminals — use + to start one.
          </div>
        ) : (
          tabs.map((tab) => (
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
                reviewKey={reviewKey}
                tabId={tab.id}
                focusedId={tab.focused}
                tabActive={tab.id === activeTabId}
                onFocus={(id) => setFocusedTerminalPane(reviewKey, tab.id, id)}
                onSplit={(id, direction) => handleSplit(tab.id, id, direction)}
                onClose={handleClosePane}
              />
            </div>
          ))
        )}
      </div>
    </div>
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
