import { useMemo } from "react";
import { useReviewStore } from "../index";
import { makeReviewKey } from "../../utils/review-key";
import type { WorkItem } from "../../types";

/** The user's work items, in priority order. */
export function useWorkItems(): WorkItem[] {
  return useReviewStore((s) => s.workItems);
}

/**
 * The review keys every work item has bound, as one set.
 *
 * For the caller asking about many refs at once — the repos tree, deciding
 * which of a repo's rows the cards above already account for (`visibleRows`).
 * A caller with one ref in hand should ask about that ref instead of building
 * this to answer once.
 */
function workCoveredKeys(items: WorkItem[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    for (const ref of item.refs) {
      keys.add(makeReviewKey(ref.repoPath, ref.ref));
    }
  }
  return keys;
}

/**
 * [`workCoveredKeys`] over the current queue, rebuilt only when the list
 * actually changes. `loadWorkItems` keeps the previous array when a refresh
 * returns an identical list, so this memo survives the watcher and focus
 * refreshes that fire on no real change.
 */
export function useWorkCoveredKeys(): Set<string> {
  const items = useWorkItems();
  return useMemo(() => workCoveredKeys(items), [items]);
}
