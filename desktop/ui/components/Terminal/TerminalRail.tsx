import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import type { TerminalTab } from "../../stores/slices/terminalSlice";
import {
  Rail,
  RailButton,
  RailSeparator,
  RailTab,
  RailRestoreIcon,
} from "../ui/rail";
import { PhaseDot } from "../TabRail/PhaseDot";
import { phaseSummary } from "../TabRail/terminal-status-format";
import { tabGlance } from "./glance";
import { TerminalGlanceCard } from "./TerminalGlanceCard";

/**
 * The terminal panel's closed state. Hiding the panel used to leave nothing
 * behind — the only way back was ⌘`, which you had to already know. This keeps
 * a sliver of the panel on its dock edge instead: a restore control, and every
 * tab turned on its side, so a shell that needs you is still nameable while the
 * diff has the full width. It shows the same one list the open panel does, so
 * collapsing never hides a terminal. Hovering a tab peeks at its screen — the
 * panel being collapsed doesn't mean flying blind.
 */
export function TerminalRail(): ReactNode {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const tabs = useReviewStore((s) => s.terminalTabs);
  const activeTabId = useReviewStore((s) => s.activeTabId);
  const terminalDockSide = useReviewStore((s) => s.terminalDockSide);
  const toggleTerminalPanel = useReviewStore((s) => s.toggleTerminalPanel);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);

  const showTab = (tab: TerminalTab) => {
    setActiveTab(tab.id);
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
          const { statuses, severity, allDead, title, primaryId } = tabGlance(
            tab,
            terminalSessions,
            terminalStatuses,
            terminalExited,
          );
          const phase = severity ?? "idle";
          const label = allDead
            ? `${title} — exited`
            : `${title} — ${phaseSummary(phase, statuses)}`;

          return (
            <RailTab
              key={tab.id}
              text={title}
              label={label}
              edge={terminalDockSide}
              active={tab.id === activeTabId}
              onClick={() => showTab(tab)}
              marker={<PhaseDot phase={phase} dead={allDead} />}
              rich={
                allDead ? undefined : (
                  <TerminalGlanceCard sessionId={primaryId} />
                )
              }
            />
          );
        })}
      </div>
    </Rail>
  );
}
