import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useFocusedWorkspace } from "../../stores/selectors/workspaces";
import { useWorkspaceTabs } from "../../stores/selectors/terminals";
import type { TerminalTab } from "../../stores/slices/terminalSlice";
import { Rail, RailTab } from "../ui/rail";
import { PhaseDot } from "../Sidebar/PhaseDot";
import { phaseSummary } from "../Sidebar/terminal-status-format";
import { tabGlance } from "./glance";
import { TerminalGlanceCard } from "./TerminalGlanceCard";

/**
 * The terminal, while the code has focus. Focusing the code used to leave
 * nothing behind — the only way back was ⌘`, which you had to already know.
 * This keeps a sliver of the panel on its dock edge instead: every tab turned
 * on its side, so a shell that needs you is still nameable while the code has
 * the full width, and picking one is itself the way back. It shows the same
 * list the open panel does — this workspace's terminals — so losing focus never
 * hides one of them. Hovering a tab peeks at its screen: the panel being
 * collapsed doesn't mean flying blind.
 *
 * The exit lives on the code half's bar, which is the visible one whenever this
 * rail is drawn; a second copy of it here would be the same verb twice.
 */
export function TerminalRail(): ReactNode {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const activeTabId = useReviewStore((s) => s.activeTabId);
  // The same scoping the open panel applies, through the same selector — the
  // rail is the panel, narrow, and the two must not list different terminals.
  const focusedWorkspace = useFocusedWorkspace();
  const tabs = useWorkspaceTabs(focusedWorkspace?.id ?? null);
  const toggleTerminalPanel = useReviewStore((s) => s.toggleTerminalPanel);
  const setActiveTab = useReviewStore((s) => s.setActiveTab);

  const showTab = (tab: TerminalTab) => {
    setActiveTab(tab.id);
    toggleTerminalPanel();
  };

  return (
    <Rail className="panel-card w-full bg-surface-inset">
      {/* The tabs themselves, turned on their side — the reason the rail earns
          its width. Picking one restores the panel with that tab active. */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {tabs.map((tab) => {
          const { statuses, severity, allDead, title, primaryId, agent } =
            tabGlance(tab, terminalSessions, terminalStatuses, terminalExited);
          const phase = severity ?? "idle";
          const label = allDead
            ? `${title} — exited`
            : `${title} — ${phaseSummary(phase, statuses)}`;

          return (
            <RailTab
              key={tab.id}
              text={title}
              label={label}
              edge="left"
              active={tab.id === activeTabId}
              onClick={() => showTab(tab)}
              marker={<PhaseDot phase={phase} dead={allDead} agent={agent} />}
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
