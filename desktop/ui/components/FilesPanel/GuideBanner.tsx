import { type ReactNode, useCallback, useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import {
  computeGuideGroups,
  countGroupUnreviewed,
} from "../../stores/selectors/groups";
import { jumpToGroup } from "./jumpToGroup";

const SPARKLE_ICON = (
  <svg
    className="h-3.5 w-3.5 shrink-0 text-guide"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M12 2l1.8 5.6L19.5 9l-5.7 1.4L12 16l-1.8-5.6L4.5 9l5.7-1.4L12 2z" />
    <path d="M19 14l.9 2.6L22.5 17l-2.6.9L19 20.5l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
  </svg>
);

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
 * (`reviewState.guide.state.groups`). Clicking it jumps into the first
 * incomplete guide group via {@link jumpToGroup}, the "jump in" behavior a
 * dedicated Guide grouping mode used to provide.
 *
 * Subscribes narrowly (a has-guide boolean, the guide grouping structure,
 * and whether scope is guide-active) rather than the full `reviewState`, so
 * this banner doesn't re-render on every hunk approve/reject — it reads
 * `reviewState` fresh via getState() only at click time, to pick which
 * group to jump into.
 */
export function GuideBanner(): ReactNode {
  const hasGuide = useReviewStore(
    (s) => (s.reviewState?.guide?.state?.groups.length ?? 0) > 0,
  );
  const reviewGroups = useReviewStore(
    (s) => s.getActiveGroupingEntry().reviewGroups,
  );
  const isActive = useReviewStore((s) => s.scope?.source === "guide");
  const hunks = useAllHunks();

  const groups = useMemo(
    () =>
      computeGuideGroups(reviewGroups, hunks).filter(
        (g) => g.hunkIds.length > 0,
      ),
    [reviewGroups, hunks],
  );

  const handleClick = useCallback(() => {
    const reviewState = useReviewStore.getState().reviewState;
    const target =
      groups.find((g) => countGroupUnreviewed(g, reviewState) > 0) ?? groups[0];
    if (target) jumpToGroup(target);
  }, [groups]);

  if (!hasGuide || groups.length === 0) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`mx-2 mt-1.5 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
        isActive
          ? "border-guide/40 bg-guide/15 text-guide"
          : "border-guide/25 bg-guide/5 text-guide hover:bg-guide/10"
      }`}
    >
      {SPARKLE_ICON}
      <span className="flex-1">Review guide available</span>
      {CHEVRON_RIGHT}
    </button>
  );
}
