import { type ReactNode, useMemo } from "react";
import { useReviewStore } from "../../stores";
import {
  mergeVisibleTabs,
  panelReviewKey,
  terminalSeverity,
  type TerminalTab,
} from "../../stores/slices/terminalSlice";
import {
  Rail,
  RailButton,
  RailSeparator,
  RailTab,
  RailRestoreIcon,
} from "../ui/rail";
import { PhaseDot } from "../TabRail/PhaseDot";
import { phaseLabel, basename } from "../TabRail/terminal-status-format";
import { collectLeafIds } from "./pane-tree";
import type { TerminalStatus } from "../../types";

/**
 * The terminal panel's closed state. Hiding the panel used to leave nothing
 * behind — the only way back was ⌘`, which you had to already know. This keeps
 * a sliver of the panel on its dock edge instead: a restore control, and every
 * tab turned on its side, so a shell that needs you is still nameable while the
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
  const activeTabIdByReviewKey = useReviewStore(
    (s) => s.activeTabIdByReviewKey,
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

  const activeTabId = activeTabIdByReviewKey[reviewKey] ?? tabs[0]?.id ?? null;

  const showTab = (tab: TerminalTab) => {
    setActiveTab(reviewKey, tab.id);
    toggleTerminalPanel();
  };

  return (
    <Rail className="panel-card w-full bg-surface-inset">
      <RailButton
        label="Show terminal (⌘`)"
        edge={terminalDockSide}
        onClick={toggleTerminalPanel}
      >
        <RailRestoreIcon edge={terminalDockSide} />
      </RailButton>

      {tabs.length > 0 && <RailSeparator />}

      {/* The tabs themselves, turned on their side — the reason the rail earns
          its width. Picking one restores the panel with that tab active. */}
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
            <RailTab
              key={tab.id}
              text={title}
              label={label}
              edge={terminalDockSide}
              active={tab.id === activeTabId}
              onClick={() => showTab(tab)}
              marker={<PhaseDot phase={phase} dead={allDead} />}
            />
          );
        })}
      </div>
    </Rail>
  );
}
