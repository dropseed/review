import { useMemo } from "react";
import { useReviewStore } from "../index";
import {
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
