// Shared "jump into a group" orchestration: scope the queue to it, sync the
// guide viewer when it's a guide group, and focus the first unreviewed hunk
// in it (falling back to the first hunk). Used by GuideBanner's "jump in"
// click and ReviewFilterBar's "Next: <group> →" advance button so both land
// on exactly the same hunk the same way.
//
// Commit groups are not handled here: narrowing to a commit re-diffs (see
// commitRange), which discards the very hunks this function focuses. Commit
// selection goes through `setCommitRange` in CommitRangePicker instead.

import { useReviewStore } from "../../stores";
import { getHunkByIdMap } from "../../stores/selectors/hunks";
import type { Group } from "../../stores/selectors/groups";
import { effectiveHunkStatus } from "../../types";
import type { ReviewStore } from "../../stores/types";

/**
 * Scope the review queue to `group` and point the guide's section index at it.
 * Shared by both entry points below so the section a reviewer is "in" is the
 * same whether they opened its rolling diff or one of its files.
 */
function scopeToGroup(state: ReviewStore, group: Group): void {
  state.setScope({
    source: group.source,
    key: group.key,
    title: group.title,
    hunkIds: group.hunkIds,
  });

  if (group.source === "guide") {
    const reviewGroups = state.getActiveGroupingEntry().reviewGroups;
    const idx = reviewGroups.findIndex((g) => g.title === group.key);
    if (idx >= 0) state.setActiveGroupIndex(idx);
  }
}

/** First unreviewed id in `ids`, falling back to the first id. */
function firstUnreviewed(
  state: ReviewStore,
  ids: string[],
): string | undefined {
  const trustList = state.reviewState?.trustList ?? [];
  return (
    ids.find(
      (id) =>
        effectiveHunkStatus(state.reviewState?.hunks[id], trustList) ===
        "unreviewed",
    ) ?? ids[0]
  );
}

export function jumpToGroup(group: Group): void {
  const state = useReviewStore.getState();

  scopeToGroup(state, group);
  state.setGuideContentMode(group.source === "guide" ? "group" : null);

  const targetId = firstUnreviewed(state, group.hunkIds);
  if (!targetId) return;

  const hunk = getHunkByIdMap(state.filesByPath).get(targetId);
  if (!hunk) return;

  useReviewStore.setState({
    selectedFile: hunk.filePath,
    focusedHunkId: targetId,
    scrollTarget: { type: "hunk", hunkId: targetId },
  });
}

/**
 * Open one file of `group` in the normal file viewer instead of the group's
 * rolling diff — the guide sidebar's nested file rows.
 *
 * The scope stays the *whole* group rather than narrowing to the file: the
 * file viewer already collapses out-of-scope hunks to thin strips, so a group
 * scope is exactly what renders "this file's full diff with only this
 * section's hunks open". Narrowing further would also strand hunk-to-hunk
 * navigation at the end of the file instead of carrying on into the section's
 * next file.
 */
export function jumpToGroupFile(group: Group, filePath: string): void {
  const state = useReviewStore.getState();

  scopeToGroup(state, group);

  const hunkById = getHunkByIdMap(state.filesByPath);
  const fileHunkIds = group.hunkIds.filter(
    (id) => hunkById.get(id)?.filePath === filePath,
  );
  const targetId = firstUnreviewed(state, fileHunkIds);

  // Leaving guide content mode is what swaps MultiFileDiffViewer out for the
  // file viewer; the sibling overlays go with it so ContentArea can't fall
  // through to a stale one.
  useReviewStore.setState({
    guideContentMode: null,
    adhocGroup: null,
    workingTreeMultiView: null,
    selectedFile: filePath,
    focusedHunkId: targetId ?? null,
    scrollTarget: targetId ? { type: "hunk", hunkId: targetId } : null,
  });
}
