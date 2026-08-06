import { useMemo } from "react";
import { useReviewStore } from "../index";
import {
  mergeVisibleTabs,
  panelReviewKey,
  selectLiveSessionsByReviewKey,
  selectSessionsByHomeKey,
} from "../slices/terminalSlice";

/**
 * Live session ids grouped by the review key that owns them.
 *
 * One hook so the sidebar tree and the collapsed rail can't disagree about
 * which rows have shells running in them — they read the same grouping rather
 * than each deriving one.
 */
export function useLiveSessionsByReviewKey(): Record<string, string[]> {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalExited = useReviewStore((s) => s.terminalExited);
  const terminalCheckouts = useReviewStore((s) => s.terminalCheckouts);
  const terminalHomes = useReviewStore((s) => s.terminalHomes);

  return useMemo(
    () =>
      selectLiveSessionsByReviewKey({
        terminalSessions,
        terminalExited,
        terminalCheckouts,
        terminalHomes,
      }),
    [terminalSessions, terminalExited, terminalCheckouts, terminalHomes],
  );
}

/**
 * Every session (exited included) grouped by the row that owns it.
 *
 * Built once per state change and shared by every row's badge — the sidebar
 * renders dozens of rows, and each deriving its own membership was both a scan
 * per row and a second chance to disagree with the tab strip.
 */
export function useSessionsByHomeKey(): Record<string, string[]> {
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const terminalCheckouts = useReviewStore((s) => s.terminalCheckouts);
  const terminalHomes = useReviewStore((s) => s.terminalHomes);

  return useMemo(
    () =>
      selectSessionsByHomeKey({
        terminalSessions,
        terminalCheckouts,
        terminalHomes,
      }),
    [terminalSessions, terminalCheckouts, terminalHomes],
  );
}

/**
 * The terminal the user is in right now: the focused leaf of the active tab
 * the open panel is showing. Mirrors TerminalPanel's own resolution (viewed
 * review key → visible tabs → active tab) so the sidebar highlight can never
 * point at a different pane than the panel does. Null while the panel is
 * closed — there is no "terminal you're in" without one on screen.
 */
export function useCurrentTerminalId(): string | null {
  return useReviewStore((s) => {
    if (s.terminalPanelMode === "closed" || !s.repoPath) return null;
    const reviewKey = panelReviewKey(
      s.terminalCheckouts,
      s.repoPath,
      s.reviewRef,
    );
    const visible = mergeVisibleTabs(s.terminalTabsByReviewKey, reviewKey);
    const activeTabId =
      s.activeTabIdByReviewKey[reviewKey] ?? visible[0]?.tab.id ?? null;
    const tab = visible.find((v) => v.tab.id === activeTabId)?.tab;
    return tab?.focused ?? null;
  });
}
