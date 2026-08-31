import { type ReactNode, useCallback } from "react";
import { useSpurStore } from "../../stores";
import { countGroupUnreviewed } from "../../stores/selectors/groups";
import { jumpToGroup } from "./jumpToGroup";
import { useGuideGroups } from "./useGuideGroups";

const CHEVRON_RIGHT = (
  <svg
    className="h-3 w-3 shrink-0 text-fg-faint"
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
 * Minimal entry point for an agent-authored guide (`spur guide add`): a row
 * in the files column, shown only when one exists for this comparison — same
 * availability check the old Guide grouping tab used
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
  const hasGuide = useSpurStore(
    (s) => (s.reviewState?.guide?.state?.groups.length ?? 0) > 0,
  );
  const groups = useGuideGroups();

  const handleClick = useCallback(() => {
    const state = useSpurStore.getState();
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
      className="flex w-full shrink-0 items-center gap-1.5 border-b border-edge/60 px-3 py-1.5
                 text-left text-xs text-fg-muted hover:bg-fg/[0.04] hover:text-fg-secondary
                 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring/70"
    >
      <span className="flex-1">Review guide available</span>
      {CHEVRON_RIGHT}
    </button>
  );
}
