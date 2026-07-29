import { useMemo } from "react";
import { useReviewStore } from "../index";
import { selectLiveSessionsByReviewKey } from "../slices/terminalSlice";

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

  return useMemo(
    () =>
      selectLiveSessionsByReviewKey({
        terminalSessions,
        terminalExited,
        terminalCheckouts,
      }),
    [terminalSessions, terminalExited, terminalCheckouts],
  );
}
