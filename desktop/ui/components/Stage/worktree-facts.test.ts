import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { sessionsUnder, useWorktreeInUse } from "./worktree-facts";
import { useSpurStore } from "../../stores";
import { attachment, workspace } from "../../test/fixtures";
import type { SpurStore } from "../../stores/types";
import type { WorktreeStatus } from "../../types";

describe("sessionsUnder", () => {
  it("matches a session sitting exactly at the worktree path", () => {
    const sessions = { a: { cwd: "/repo/feature" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([sessions.a]);
  });

  it("matches a session nested under the worktree path", () => {
    const sessions = { a: { cwd: "/repo/feature/src" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([sessions.a]);
  });

  it("does not let a sibling with a shared prefix claim the worktree", () => {
    const sessions = { a: { cwd: "/repo/feature-2" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([]);
  });

  it("excludes a session in an unrelated directory", () => {
    const sessions = { a: { cwd: "/repo/other" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([]);
  });

  it("returns every matching session, not just the first", () => {
    const sessions = {
      a: { cwd: "/repo/feature" },
      b: { cwd: "/repo/feature/nested" },
      c: { cwd: "/repo/other" },
    };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([
      sessions.a,
      sessions.b,
    ]);
  });

  it("returns nothing for an empty session map", () => {
    expect(sessionsUnder({}, "/repo/feature")).toEqual([]);
  });
});

/**
 * The three names a worktree is reached by, and the order they are asked in.
 * Only a hint on a row — what stops a delete is the backend's dirty check.
 */
describe("useWorktreeInUse", () => {
  const REPO = "/repo";
  const WT = "/worktrees/repo-feature";

  function status(overrides: Partial<WorktreeStatus> = {}): WorktreeStatus {
    return {
      path: WT,
      branch: "feature",
      isMain: false,
      commitHash: "abc123",
      isDetached: false,
      isReviewManaged: false,
      hasChanges: false,
      ...overrides,
    };
  }

  function inUse(state: Partial<SpurStore>) {
    useSpurStore.setState({
      workspaces: [],
      terminalSessions: {},
      ...state,
    } as Partial<SpurStore> as SpurStore);
    return renderHook(() => useWorktreeInUse()).result.current;
  }

  it("counts a worktree a workspace attached as its own tab", () => {
    const ask = inUse({
      workspaces: [
        workspace("w", {
          attachments: [attachment(WT, "feature", true, REPO)],
        }),
      ],
    });
    expect(ask(REPO, status())).toBe(true);
  });

  /** The main tree pointed at that branch is the same work by another name. */
  it("counts the repo at that branch", () => {
    const ask = inUse({
      workspaces: [
        workspace("w", { attachments: [attachment(REPO, "feature")] }),
      ],
    });
    expect(ask(REPO, status())).toBe(true);
    expect(ask(REPO, status({ branch: "other" }))).toBe(false);
  });

  /** The loudest form: a shell is sitting in it, whatever the queue forgot. */
  it("counts a terminal in the directory", () => {
    const ask = inUse({
      terminalSessions: {
        a: { cwd: `${WT}/src` },
      } as unknown as SpurStore["terminalSessions"],
    });
    expect(ask(REPO, status())).toBe(true);
  });

  it("is false when nothing points at it", () => {
    expect(inUse({})(REPO, status())).toBe(false);
  });
});
