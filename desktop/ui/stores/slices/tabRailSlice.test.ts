import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../api", () => ({
  getApiClient: () => ({ listWorkspaces: vi.fn().mockResolvedValue([]) }),
}));

import { useSpurStore } from "../index";
import { attachment, workspace } from "../../test/fixtures";

const REPO = "/repo";
/** A linked worktree of REPO — a tab of its own, filed under REPO. */
const WORKTREE = "/worktrees/repo-wt";

afterEach(() => {
  useSpurStore.setState({
    workspaces: [],
    focusedWorkspaceId: null,
    activeReviewKey: null,
    workspaceCodeKeys: {},
  });
});

describe("setActiveReviewKey", () => {
  it("resolves the tab of the focused workspace", () => {
    const focused = workspace("w", {
      attachments: [
        attachment(REPO, "main"),
        attachment(WORKTREE, "feature", true, REPO),
      ],
    });
    useSpurStore.setState({ workspaces: [focused], focusedWorkspaceId: "w" });

    useSpurStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "feature" });

    expect(useSpurStore.getState().activeReviewKey?.path).toBe(WORKTREE);
    // ...and the memory is the resolved key, so coming back opens that tab.
    expect(useSpurStore.getState().workspaceCodeKeys["w"]?.path).toBe(WORKTREE);
  });

  it("believes a caller that names the tab itself", () => {
    const focused = workspace("w", {
      attachments: [attachment(WORKTREE, "feature", true, REPO)],
    });
    useSpurStore.setState({ workspaces: [focused], focusedWorkspaceId: "w" });

    useSpurStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "main", path: WORKTREE });

    expect(useSpurStore.getState().activeReviewKey?.path).toBe(WORKTREE);
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("w");
  });

  /**
   * Staleness is judged by the tab when there is one: a comparison opened in a
   * checkout this workspace doesn't hold is somebody else's, even though the
   * repository is one it shows.
   */
  it("drops the focus for a checkout the workspace doesn't hold", () => {
    const focused = workspace("w", {
      attachments: [attachment(REPO, "main")],
    });
    useSpurStore.setState({ workspaces: [focused], focusedWorkspaceId: "w" });

    useSpurStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "feature", path: WORKTREE });

    expect(useSpurStore.getState().focusedWorkspaceId).toBeNull();
  });
});
