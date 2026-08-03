import { useMemo, type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useSessionsByHomeKey } from "../../stores/selectors/terminals";
import { PhaseDot } from "../TabRail/PhaseDot";
import { overviewGroups } from "./glance";
import { TerminalGlanceCard } from "./TerminalGlanceCard";
import { jumpToTerminal } from "./jump";

/**
 * Every terminal in every repo, as a grid of live cards — the "where is each
 * of my agents at?" answer in one screen, instead of a tour of clicks. Cards
 * are sorted by who needs a human first; clicking one jumps to that shell,
 * switching review rows if it lives somewhere else.
 */
export function TerminalOverview(): ReactNode {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalStatuses = useReviewStore((s) => s.terminalStatuses);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const sessionsByHomeKey = useSessionsByHomeKey();

  const groups = useMemo(
    () =>
      overviewGroups(
        sessionsByHomeKey,
        terminalSessions,
        terminalStatuses,
        terminalExited,
      ),
    [sessionsByHomeKey, terminalSessions, terminalStatuses, terminalExited],
  );

  if (groups.length === 0) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-inset text-xs text-fg-faint">
        No terminals running.
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-surface-inset px-3 pb-3 scrollbar-thin">
      {groups.map((group) => (
        <section key={group.key} className="pt-3">
          <h3 className="flex items-center gap-1.5 px-0.5 pb-1.5 text-xxs font-medium text-fg-muted">
            {group.severity && <PhaseDot phase={group.severity} />}
            <span className="truncate">{group.label}</span>
            <span className="text-fg-faint tabular-nums">
              {group.ids.length}
            </span>
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2">
            {group.ids.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => jumpToTerminal(id)}
                className="rounded-md border border-edge/50 bg-surface pb-0.5 text-left
                           transition-colors duration-100 hover:border-edge
                           hover:bg-surface-raised focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-focus-ring/50"
              >
                <TerminalGlanceCard sessionId={id} className="w-full" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
