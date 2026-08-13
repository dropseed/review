import { useReviewStore } from "../stores";
import { findSidebarRow } from "../stores/selectors/sidebar";
import { makeReviewKey } from "../utils/review-key";
import { workItemTitle } from "../components/TabRail/work-status";
import { getCommandUi } from "./host";
import type { WorkItem, WorkRef } from "../types";
import type { Command } from "./types";

/** Only the first nine get a positional shortcut; the rest are typed for. */
const SHORTCUT_LIMIT = 9;

/**
 * Open one bound ref — a chip clicked, or its "Activate" verb.
 *
 * A ref whose row is gone deliberately does nothing: opening a review of
 * something that isn't there is worse than staying put.
 */
export function activateWorkRef(ref: WorkRef): void {
  const key = makeReviewKey(ref.repoPath, ref.ref);
  if (!findSidebarRow(useReviewStore.getState(), key)) return;

  getCommandUi().activateReviewKey(ref.repoPath, ref.ref);
}

/**
 * Open what a work item points at — its first bound ref, and the terminal it
 * was last working in.
 *
 * The one implementation, shared by the card, the collapsed rail's number, and
 * ⌘1–9, so all three land in the same place. An item with no refs is a note,
 * which has nowhere to go — but it can still own terminals, so the tab is
 * selected either way.
 *
 * Selecting a tab only moves what the strip is showing. The strip is one list
 * of every terminal there is, so activating an item never hides another one's.
 */
export function activateWorkItem(item: WorkItem): void {
  const ref = item.refs[0];
  if (ref) activateWorkRef(ref);
  useReviewStore.getState().selectItemTab(item.id);
}

/**
 * One command per work item, ⌘1–9 for the first nine.
 *
 * The digits used to walk the sidebar's rows, which meant the app's most-used
 * navigation was positional over a list the app reordered on its own. They
 * follow the one list the user orders by hand instead: ⌘3 is the third card,
 * and it stays the third card until the user drags it.
 */
let cache: { items: WorkItem[]; commands: Command[] } | null = null;

export function workCommands(): Command[] {
  const items = useReviewStore.getState().workItems;
  // Every keystroke in the palette re-resolves every dynamic source, so the
  // list is rebuilt only when the queue itself changes. `loadWorkItems` keeps
  // the previous array when a refresh returns an identical list, which is what
  // makes identity the right test.
  if (cache?.items === items) return cache.commands;

  const commands: Command[] = items.map((item, index) => ({
    id: `work.activate.${item.id}`,
    title: workItemTitle(item),
    category: "Working on",
    keywords: item.refs.map((ref) => ref.ref),
    shortcut:
      index < SHORTCUT_LIMIT
        ? { code: `Digit${index + 1}`, mod: true }
        : undefined,
    run: () => activateWorkItem(item),
  }));

  cache = { items, commands };
  return commands;
}
