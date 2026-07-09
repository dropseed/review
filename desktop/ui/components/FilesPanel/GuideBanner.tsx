import { type ReactNode, useCallback } from "react";
import { useReviewStore } from "../../stores";
import { countGroupUnreviewed } from "../../stores/selectors/groups";
import { SparkleIcon } from "../ui/icons";
import { jumpToGroup } from "./jumpToGroup";
import { useGuideGroups } from "./useGuideGroups";

const CHEVRON_RIGHT = (
  <svg
    className="h-3 w-3 shrink-0 text-guide/70"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/**
 * Minimal sidebar entry point for an agent-authored guide (`review guide
 * add`): a compact purple banner shown only when one exists for this
 * comparison — same availability check the old Guide grouping tab used
 * (`reviewState.guide.state.groups`). Clicking it swaps the sidebar into
 * guide mode ({@link GuideModePanel}) and jumps into the first incomplete
 * guide group via {@link jumpToGroup}, the "jump in" behavior a dedicated
 * Guide grouping mode used to provide.
 *
 * Subscribes narrowly (a has-guide boolean and the guide grouping
 * structure) rather than the full `reviewState`, so this banner doesn't
 * re-render on every hunk approve/reject — it reads `reviewState` fresh via
 * getState() only at click time, to pick which group to jump into. Only
 * rendered in normal (non-guide-mode) review, so it has no active state of
 * its own.
 */
export function GuideBanner(): ReactNode {
  const hasGuide = useReviewStore(
    (s) => (s.reviewState?.guide?.state?.groups.length ?? 0) > 0,
  );
  const groups = useGuideGroups();

  const handleClick = useCallback(() => {
    const state = useReviewStore.getState();
    state.setGuideMode(true);
    const target =
      groups.find((g) => countGroupUnreviewed(g, state.reviewState) > 0) ??
      groups[0];
    if (target) jumpToGroup(target);
  }, [groups]);

  if (!hasGuide || groups.length === 0) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mx-2 mt-1.5 flex items-center gap-1.5 rounded-md border border-guide/25 bg-guide/5 px-2.5 py-1.5 text-left text-xs font-medium text-guide transition-colors hover:bg-guide/10"
    >
      <SparkleIcon />
      <span className="flex-1">Review guide available</span>
      {CHEVRON_RIGHT}
    </button>
  );
}
