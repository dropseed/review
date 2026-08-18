import { describe, it, expect } from "vitest";
import { unansweredWorkspaceIds } from "./useAttentionBadge";
import type { WorkspaceTerminals } from "../stores/selectors/terminals";
import { workspace } from "../test/fixtures";

function terminals(
  needsAttentionSince: number | null,
): Record<string, WorkspaceTerminals> {
  return {
    a: {
      tabs: 1,
      phase: needsAttentionSince == null ? "working" : "needs_attention",
      waitingOn: null,
      waitingSince: needsAttentionSince,
      needsAttentionSince,
    },
  };
}

const queue = [workspace("a"), workspace("b")];

describe("unansweredWorkspaceIds", () => {
  it("counts a workspace whose attention is newer than the last look", () => {
    expect(unansweredWorkspaceIds(queue, terminals(200), { a: 100 })).toEqual([
      "a",
    ]);
  });

  it("counts one that has never been looked at", () => {
    expect(unansweredWorkspaceIds(queue, terminals(200), {})).toEqual(["a"]);
  });

  it("drops one looked at since it started asking", () => {
    expect(unansweredWorkspaceIds(queue, terminals(200), { a: 300 })).toEqual(
      [],
    );
  });

  it("ignores a workspace whose terminals are merely running", () => {
    expect(unansweredWorkspaceIds(queue, terminals(null), {})).toEqual([]);
  });

  it("ignores a workspace with no terminals at all", () => {
    expect(unansweredWorkspaceIds(queue, {}, {})).toEqual([]);
  });

  it("counts a second spell in a workspace already acknowledged once", () => {
    expect(unansweredWorkspaceIds(queue, terminals(400), { a: 300 })).toEqual([
      "a",
    ]);
  });
});
