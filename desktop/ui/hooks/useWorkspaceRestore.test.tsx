import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

// The store wires a real backend client at module load; stub both, the same
// way the other store-backed hook tests do.
vi.mock("../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

const focusWorkspace = vi.fn();
const targetForAttachment = vi.fn((attachment: { path: string }) => ({
  repoPath: attachment.path,
  ref: "main",
}));
vi.mock("../commands/workspaceCommands", () => ({
  focusWorkspace: (...args: unknown[]) => focusWorkspace(...args),
  targetForAttachment: (attachment: { path: string }) =>
    targetForAttachment(attachment),
}));

import { useSpurStore } from "../stores";
import { useWorkspaceRestore } from "./useWorkspaceRestore";
import type { RepoStatus } from "./useRepositoryInit";
import type { Workspace } from "../types";

function workspace(id: string, paths: string[] = []): Workspace {
  return {
    id,
    title: null,
    displayTitle: id,
    attachments: paths.map((path) => ({
      path,
      refName: "main",
      isGitRepo: true,
    })),
    parentId: null,
    depth: 0,
    ancestors: [],
    autoCreated: false,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const queue = [workspace("aaa", ["/repo/a"]), workspace("bbb", ["/repo/b"])];

function seed(state: Partial<Record<string, unknown>> = {}) {
  useSpurStore.setState({
    workspaces: queue,
    focusedWorkspaceId: null,
    activeReviewKey: null,
    repoPath: null,
    isStandaloneFile: false,
    lastWorkspaceId: "bbb",
    localActivity: [],
    globalReviews: [],
    ...state,
  } as never);
}

beforeEach(() => {
  focusWorkspace.mockClear();
  targetForAttachment.mockClear();
  seed();
});

afterEach(cleanup);

describe("useWorkspaceRestore", () => {
  it("comes back to the workspace the stage was last showing", () => {
    renderHook(() => useWorkspaceRestore("found"));

    expect(focusWorkspace).toHaveBeenCalledWith(
      queue[1],
      { repoPath: "/repo/b", ref: "main" },
      // Nobody did this, so it acknowledges nothing — `useAttentionBadge`
      // clears the signal once the window actually has focus.
      { acknowledge: false },
    );
  });

  it("leaves an open comparison alone and only takes the focus", () => {
    // The state a relaunch lands in when the launch directory named a repo:
    // a diff on screen, and no workspace focused because nothing shows it.
    seed({ activeReviewKey: { repoPath: "/elsewhere", ref: "main" } });

    renderHook(() => useWorkspaceRestore("found"));

    expect(focusWorkspace).not.toHaveBeenCalled();
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("bbb");
  });

  it("stands down when a workspace is already on the stage", () => {
    seed({ focusedWorkspaceId: "aaa" });

    renderHook(() => useWorkspaceRestore("found"));

    expect(focusWorkspace).not.toHaveBeenCalled();
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("aaa");
  });

  it("restores once the queue lands, not before", () => {
    seed({ workspaces: [] });
    const { rerender } = renderHook(() => useWorkspaceRestore("found"));
    expect(focusWorkspace).not.toHaveBeenCalled();

    act(() => useSpurStore.setState({ workspaces: queue } as never));
    rerender();

    expect(focusWorkspace).toHaveBeenCalledWith(
      queue[1],
      expect.anything(),
      expect.anything(),
    );
  });

  it("waits for the sidebar to resolve the repo before opening", () => {
    targetForAttachment.mockReturnValue(null as never);
    const { rerender } = renderHook(() => useWorkspaceRestore("found"));
    expect(focusWorkspace).not.toHaveBeenCalled();

    // The rows land, and the same workspace opens on the next tick.
    targetForAttachment.mockImplementation((attachment) => ({
      repoPath: attachment.path,
      ref: "main",
    }));
    act(() => useSpurStore.setState({ localActivity: [{}] } as never));
    rerender();

    expect(focusWorkspace).toHaveBeenCalledWith(
      queue[1],
      { repoPath: "/repo/b", ref: "main" },
      expect.anything(),
    );
  });

  it("waits for the launch's own repo decision", () => {
    const { rerender } = renderHook(
      ({ status }: { status: RepoStatus }) => useWorkspaceRestore(status),
      { initialProps: { status: "loading" as RepoStatus } },
    );
    expect(focusWorkspace).not.toHaveBeenCalled();

    rerender({ status: "not_found" });

    expect(focusWorkspace).toHaveBeenCalledWith(
      queue[1],
      expect.anything(),
      expect.anything(),
    );
  });

  /**
   * Browse and standalone mode open a repo and no comparison at all, and
   * derivation reads the repo either way — so the launch has already landed
   * inside the workspace showing it and there is nothing to restore.
   */
  it("leaves a browse-mode launch in the workspace it derived", () => {
    seed({ repoPath: "/repo/a" });

    renderHook(() => useWorkspaceRestore("found"));

    expect(focusWorkspace).not.toHaveBeenCalled();
    expect(useSpurStore.getState().focusedWorkspaceId).toBeNull();
  });

  /**
   * The same launch onto a repo nothing in the queue shows: derivation has no
   * answer, so the focus is the part that was missing — and the screen the
   * launch asked for is still the screen it keeps.
   */
  it("takes only the focus back when nothing derives the browsed repo", () => {
    seed({ repoPath: "/elsewhere" });

    renderHook(() => useWorkspaceRestore("found"));

    expect(focusWorkspace).not.toHaveBeenCalled();
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("bbb");
  });

  it("leaves a closed repo closed", () => {
    renderHook(() => useWorkspaceRestore("welcome"));

    expect(focusWorkspace).not.toHaveBeenCalled();
    expect(useSpurStore.getState().focusedWorkspaceId).toBeNull();
  });

  it("remembers the workspace on screen, derived focus included", () => {
    seed({
      lastWorkspaceId: null,
      focusedWorkspaceId: null,
      activeReviewKey: { repoPath: "/repo/a", ref: "main" },
    });

    renderHook(() => useWorkspaceRestore("found"));

    // Nothing was restored — but the workspace showing that repo is where the
    // stage is, so that is what the next launch comes back to.
    expect(focusWorkspace).not.toHaveBeenCalled();
    expect(useSpurStore.getState().lastWorkspaceId).toBe("aaa");
  });
});
