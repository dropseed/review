import { describe, it, expect } from "vitest";
import { restoreDecision, type RestoreInput } from "./workspace-restore";
import type { Workspace } from "../types";

function workspace(id: string, paths: string[] = []): Workspace {
  return {
    id,
    title: null,
    displayTitle: id,
    attachments: paths.map((path) => ({ path, refName: "main" })),
    parentId: null,
    depth: 0,
    ancestors: [],
    autoCreated: false,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const queue = [workspace("aaa", ["/repo/a"]), workspace("bbb", ["/repo/b"])];

function decide(overrides: Partial<RestoreInput> = {}) {
  return restoreDecision({
    lastWorkspaceId: "bbb",
    workspaces: queue,
    focused: null,
    stageClaimed: false,
    dismissed: false,
    initSettled: true,
    target: { repoPath: "/repo/b", ref: "main" },
    expired: false,
    ...overrides,
  });
}

describe("restoreDecision", () => {
  it("opens the workspace the stage was last showing", () => {
    expect(decide()).toEqual({
      kind: "open",
      workspace: queue[1],
      target: { repoPath: "/repo/b", ref: "main" },
    });
  });

  it("stands down when anything already reached the stage", () => {
    // Derivation succeeding on its own is the ordinary case — a repo opened
    // from the URL or the cwd already names its workspace.
    expect(decide({ focused: queue[0] })).toEqual({ kind: "done" });
  });

  it("stands down on a first run, with nothing remembered", () => {
    expect(decide({ lastWorkspaceId: null })).toEqual({ kind: "done" });
  });

  it("waits for the queue rather than reading an empty one as gone", () => {
    expect(decide({ workspaces: [] })).toEqual({ kind: "wait" });
  });

  it("gives up on a workspace the queue no longer holds", () => {
    expect(decide({ lastWorkspaceId: "gone" })).toEqual({ kind: "done" });
  });

  it("takes only the focus when the launch already claimed the stage", () => {
    // A URL, a `review` invocation or the launch directory put that there, and
    // a person naming what to look at outranks where the app was last time.
    // The tabs coming back is the whole of what was missing. `stageClaimed`
    // covers browse and standalone mode too, which open a repo and no
    // comparison — navigating over those was the same bug in another costume.
    expect(decide({ stageClaimed: true })).toEqual({
      kind: "focus",
      workspace: queue[1],
    });
  });

  it("leaves a closed repo closed", () => {
    // "Show me nothing" is a statement about the stage, and a stronger one
    // than where the app happened to be last time.
    expect(decide({ dismissed: true })).toEqual({ kind: "done" });
  });

  it("waits for the launch to decide which repo it opens", () => {
    // Restoring first would be undone by the init's own navigation: opening a
    // comparison no workspace shows drops the focus again.
    expect(decide({ initSettled: false })).toEqual({ kind: "wait" });
  });

  it("restores anyway when the launch never answers", () => {
    expect(decide({ initSettled: false, expired: true })).toEqual({
      kind: "open",
      workspace: queue[1],
      target: { repoPath: "/repo/b", ref: "main" },
    });
  });

  it("waits for the sidebar to resolve the workspace's repo", () => {
    // Null target and not expired: the rows are still loading, and opening the
    // empty stage now would hide a workspace that is about to be openable.
    expect(decide({ target: null })).toEqual({ kind: "wait" });
  });

  it("shows the workspace anyway once the wait runs out", () => {
    expect(decide({ target: null, expired: true })).toEqual({
      kind: "open",
      workspace: queue[1],
      target: null,
    });
  });

  it("doesn't wait for a workspace that shows no repo", () => {
    const empty = [workspace("ccc")];
    expect(
      decide({ workspaces: empty, lastWorkspaceId: "ccc", target: null }),
    ).toEqual({ kind: "open", workspace: empty[0], target: null });
  });
});
