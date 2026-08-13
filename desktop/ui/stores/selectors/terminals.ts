import { useMemo } from "react";
import { useReviewStore } from "../index";
import {
  findTab,
  selectSessionsByHomeKey,
  selectTabsByItemId,
  selectUnattachedTabIds,
  terminalSeverity,
} from "../slices/terminalSlice";
import {
  sessionTitle,
  tabGlance,
  type TabGlance,
} from "../../components/Terminal/glance";
import type { TerminalPhase, TerminalSessionInfo } from "../../types";

/**
 * Every session (exited included) grouped by the checkout-derived row it sits
 * in — what the terminal overview groups by.
 *
 * Built once per state change and shared by every group, rather than each
 * deriving its own membership: that was both a scan per group and a second
 * chance to disagree.
 */
export function useSessionsByHomeKey(): Record<string, string[]> {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalCheckouts = useReviewStore((s) => s.terminalCheckouts);

  return useMemo(
    () => selectSessionsByHomeKey({ terminalSessions, terminalCheckouts }),
    [terminalSessions, terminalCheckouts],
  );
}

/**
 * Tab ids grouped by the work item they're attached to.
 *
 * Built once for the whole "Working on" section, the same reason
 * `useSessionsByHomeKey` is built once for the overview.
 */
export function useTabsByItemId(): Record<string, string[]> {
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const terminalAttachments = useReviewStore((s) => s.terminalAttachments);

  return useMemo(
    () => selectTabsByItemId({ terminalTabs, terminalAttachments }),
    [terminalTabs, terminalAttachments],
  );
}

/**
 * The loudest phase among each work item's own terminals — the colour a card's
 * dot and its rail number carry.
 *
 * One pass for the whole section, off the same grouping the rows are built
 * from. Derived here rather than per card because every card would otherwise
 * subscribe to the whole status map and re-derive on every status push, which
 * arrive seconds apart.
 */
export function usePhasesByItemId(): Record<string, TerminalPhase | null> {
  const tabsByItem = useTabsByItemId();
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const statuses = useReviewStore((s) => s.terminalStatuses);
  const sessions = useReviewStore((s) => s.terminalSessions);
  const exited = useReviewStore((s) => s.terminalExited);

  return useMemo(() => {
    const phases: Record<string, TerminalPhase | null> = {};
    for (const [itemId, tabIds] of Object.entries(tabsByItem)) {
      const glances = tabIds
        .map((tabId) => findTab(terminalTabs, tabId))
        .filter((tab) => tab != null)
        .map((tab) => tabGlance(tab, sessions, statuses, exited));
      phases[itemId] = terminalSeverity(glances.flatMap((g) => g.statuses));
    }
    return phases;
  }, [tabsByItem, terminalTabs, sessions, statuses, exited]);
}

/** One pane of a tab, as the row's status cluster draws it. */
export interface TabPaneGlance {
  id: string;
  phase: TerminalPhase;
  dead: boolean;
  title: string;
}

/** What every surface that lists a tab by name needs to draw one row. */
export interface TabRowGlance extends TabGlance {
  /** The session behind the title — where the row's repo attribution comes from. */
  session: TerminalSessionInfo | undefined;
  /** That session's exit code, for a row that reports one. */
  exitCode: number | null | undefined;
  /**
   * Every pane, in tree order. A row summarizes its tab with one phase, which
   * is the loudest of these — the cluster is how a split tab says which of its
   * panes that was. A pane the status stream hasn't reported on yet reads as
   * idle rather than being left out, so the cluster's count is the tab's.
   */
  panes: TabPaneGlance[];
}

/**
 * A tab resolved for display, or null when there is nothing to show yet.
 *
 * Null carries the sidebar's membership rule: a tab whose panes the status
 * stream hasn't reported on has no phase, no title and no place in a list — the
 * rule was pasted into every row that listed one.
 */
export function useTabGlance(tabId: string): TabRowGlance | null {
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const sessions = useReviewStore((s) => s.terminalSessions);
  const statuses = useReviewStore((s) => s.terminalStatuses);
  const exited = useReviewStore((s) => s.terminalExited);

  return useMemo(() => {
    const tab = findTab(terminalTabs, tabId);
    if (!tab) return null;
    const glance = tabGlance(tab, sessions, statuses, exited);
    if (glance.statuses.length === 0) return null;
    return {
      ...glance,
      session: sessions[tab.focused],
      exitCode: exited[tab.focused],
      panes: glance.leafIds.map((id) => ({
        id,
        phase: statuses[id]?.phase ?? "idle",
        dead: id in exited,
        title: sessionTitle(statuses[id], sessions[id]),
      })),
    };
  }, [terminalTabs, tabId, sessions, statuses, exited]);
}

/**
 * The tabs no work item accounts for — the whole of the "Unclaimed terminals"
 * band, and the only rows the sidebar has for a shell nothing owns.
 */
export function useUnattachedTabIds(): string[] {
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const terminalAttachments = useReviewStore((s) => s.terminalAttachments);
  const workItems = useReviewStore((s) => s.workItems);

  return useMemo(
    () =>
      selectUnattachedTabIds(
        { terminalTabs, terminalAttachments },
        new Set(workItems.map((item) => item.id)),
      ),
    [terminalTabs, terminalAttachments, workItems],
  );
}

/**
 * The tab the user is in right now — the one the open panel is showing. Null
 * while the panel is closed: there is no "terminal you're in" without one on
 * screen.
 */
export function useCurrentTabId(): string | null {
  return useReviewStore((s) =>
    s.terminalPanelMode === "closed" ? null : s.activeTabId,
  );
}
