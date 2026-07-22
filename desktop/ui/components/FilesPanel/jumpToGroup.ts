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

export function jumpToGroup(group: Group): void {
  const state = useReviewStore.getState();

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
    state.setGuideContentMode("group");
  } else {
    state.setGuideContentMode(null);
  }

  const trustList = state.reviewState?.trustList ?? [];
  const targetId =
    group.hunkIds.find(
      (id) =>
        effectiveHunkStatus(state.reviewState?.hunks[id], trustList) ===
        "unreviewed",
    ) ?? group.hunkIds[0];
  if (!targetId) return;

  const hunk = getHunkByIdMap(state.filesByPath).get(targetId);
  if (!hunk) return;

  useReviewStore.setState({
    selectedFile: hunk.filePath,
    focusedHunkId: targetId,
    scrollTarget: { type: "hunk", hunkId: targetId },
  });
}
