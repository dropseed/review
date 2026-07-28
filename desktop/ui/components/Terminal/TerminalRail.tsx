import { type ReactNode, useMemo } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  mergeVisibleTabs,
  panelReviewKey,
  terminalSeverity,
  type TerminalTab,
} from "../../stores/slices/terminalSlice";
import { SimpleTooltip } from "../ui/tooltip";
import { Rail, RailButton, RailRestoreIcon, railTooltipSide } from "../ui/rail";
import {
  phaseDotClass,
  phaseLabel,
  basename,
} from "../TabRail/terminal-status-format";
import { collectLeafIds } from "./pane-tree";
import type { TerminalStatus } from "../../types";

/**
 * The terminal panel's closed state. Hiding the panel used to leave nothing
 * behind — the only way back was ⌘`, which you had to already know. This keeps
 * a sliver of the panel on its dock edge instead: a restore control, and one
 * live phase dot per tab so a shell that needs you is still visible while the
 * diff has the full width.
 */
export function TerminalRail(): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const terminalCheckouts = useReviewStore((s) => s.terminalCheckouts);
  const terminalTabsByReviewKey = useReviewStore(
    (s) => s.terminalTabsByReviewKey,
  );
  const terminalDockSide = useReviewStore((s) => s.terminalDockSide);
  const toggleTerminalPanel = useReviewStore((s) => s.toggleTerminalPanel);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);

  const reviewKey = repoPath
    ? panelReviewKey(terminalCheckouts, repoPath, reviewRef)
    : "";

  // The same set the open panel would show, so collapsing it doesn't quietly
  // hide the pinned terminals you kept in view.
  const tabs = useMemo<TerminalTab[]>(
    () =>
      reviewKey
        ? mergeVisibleTabs(terminalTabsByReviewKey, reviewKey).map((v) => v.tab)
        : [],
    [reviewKey, terminalTabsByReviewKey],
  );

  if (!repoPath) return null;

  const showTab = (tab: TerminalTab) => {
    setActiveTab(reviewKey, tab.id);
    toggleTerminalPanel();
  };

  return (
    <Rail className="bg-surface-inset">
      <RailButton
        label="Show terminal (⌘`)"
        edge={terminalDockSide}
        onClick={toggleTerminalPanel}
      >
        <RailRestoreIcon edge={terminalDockSide} />
      </RailButton>

      {tabs.length > 0 && <div className="h-px w-4 shrink-0 bg-edge/60" />}

      {/* Tab dots — the reason the rail earns its width. Picking one restores
          the panel with that tab already active. */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
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
          const phase = severity ?? "idle";
          const label = allDead
            ? `${title} — exited`
            : `${title} — ${phaseLabel(phase)}`;

          return (
            <SimpleTooltip
              key={tab.id}
              content={label}
              side={railTooltipSide(terminalDockSide)}
            >
              <button
                type="button"
                onClick={() => showTab(tab)}
                aria-label={label}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded
                           hover:bg-fg/[0.08]"
              >
                <span
                  className={clsx(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    allDead ? "bg-fg-faint" : phaseDotClass(phase),
                    !allDead &&
                      (phase === "working" || phase === "needs_attention") &&
                      "animate-pulse",
                  )}
                />
              </button>
            </SimpleTooltip>
          );
        })}
      </div>
    </Rail>
  );
}
