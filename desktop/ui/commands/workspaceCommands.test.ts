import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("../api", () => ({
  getApiClient: () => ({ listWorkspaces: vi.fn().mockResolvedValue([]) }),
}));

const activateReviewKey = vi.fn();
const navigate = vi.fn();
vi.mock("./host", () => ({
  getCommandUi: () => ({ activateReviewKey, navigate }),
}));

import { focusWorkspace, workspaceCommands } from "./workspaceCommands";
import { useReviewStore } from "../stores";
import { toAccelerator } from "./shortcuts";
import { attachment, workspace } from "../test/fixtures";
import type { LocalBranchInfo, Workspace } from "../types";

const REPO = "/repo";
const OTHER = "/other";

function item(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return workspace(id, {
    attachments: [attachment(REPO, "feature")],
    ...overrides,
  });
}

function branch(name: string): LocalBranchInfo {
  return {
    name,
    isCurrent: false,
    commitsAhead: 1,
    unpushedCommits: 0,
    hasWorkingTreeChanges: true,
    lastCommitDate: new Date().toISOString(),
    lastCommitMessage: "x",
    lastCommitByUser: true,
    worktreePath: null,
    lastModifiedAt: null,
    workingTreeStats: null,
  };
}

function repoActivity(repoPath: string, branches: LocalBranchInfo[]) {
  return {
    repoPath,
    repoName: repoPath.slice(1),
    defaultBranch: "main",
    branches,
    recentRemoteBranches: [],
  };
}

function seed(items: Workspace[], branches = [branch("feature")]): void {
  useReviewStore.setState({
    workspaces: items,
    localActivity: [
      repoActivity(REPO, branches),
      repoActivity(OTHER, [branch("other")]),
    ],
  });
}

afterEach(() => {
  useReviewStore.setState({
    workspaces: [],
    localActivity: [],
    focusedWorkspaceId: null,
    activeReviewKey: null,
  });
  vi.clearAllMocks();
});

describe("⌘1–9 over the workspace queue", () => {
  it("binds the digits to the first nine cards, in the user's order", () => {
    seed(Array.from({ length: 11 }, (_, i) => item(`w${i}`)));
    const accelerators = workspaceCommands().map((c) =>
      c.shortcut ? toAccelerator(c.shortcut) : null,
    );

    expect(accelerators.slice(0, 9)).toEqual([
      "CmdOrCtrl+1",
      "CmdOrCtrl+2",
      "CmdOrCtrl+3",
      "CmdOrCtrl+4",
      "CmdOrCtrl+5",
      "CmdOrCtrl+6",
      "CmdOrCtrl+7",
      "CmdOrCtrl+8",
      "CmdOrCtrl+9",
    ]);
    // The rest are findable by typing, which is the whole reason these are
    // commands rather than nine positional key handlers.
    expect(accelerators.slice(9)).toEqual([null, null]);
  });

  it("titles an entry by the title the backend derived for it", () => {
    seed([item("a", { title: "Ship the thing" }), item("b")]);
    expect(workspaceCommands().map((c) => c.title)).toEqual([
      "Ship the thing",
      "repo · feature",
    ]);
  });

  it("opens the workspace's first repo tab", () => {
    seed([item("a")]);
    focusWorkspace(item("a"));
    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");
  });

  /**
   * A workspace with nothing to compare goes to its empty state rather than
   * leaving the previous workspace's diff on screen under this one's name.
   */
  it("sends a workspace showing no repo to its empty state", () => {
    seed([item("a", { attachments: [] })]);
    focusWorkspace(item("a", { attachments: [] }));
    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
  });

  /** An attachment with no ref names no branch, so there is no comparison. */
  it("sends a ref-less workspace to its empty state", () => {
    const only = { attachments: [attachment("/tmp/scratch")] };
    seed([item("a", only)]);
    focusWorkspace(item("a", only));
    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
  });

  /**
   * The dual-source-of-truth bug: focus was written and never cleared, so
   * opening another workspace's branch left the first workspace's header and
   * terminals over the second one's diff. Derivation is authoritative — the
   * explicit pick only survives while the repo on screen is one it shows.
   */
  it("drops the explicit focus when the repo on screen moves out of it", () => {
    seed([item("a"), item("b", { attachments: [attachment(OTHER, "other")] })]);
    focusWorkspace(item("a"));
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");

    useReviewStore
      .getState()
      .setActiveReviewKey({ repoPath: OTHER, ref: "other" });
    expect(useReviewStore.getState().focusedWorkspaceId).toBeNull();
  });

  /** A ref is a hint: another branch of the same repo is still that tab. */
  it("keeps the explicit focus across branches of a repo it shows", () => {
    seed([item("a")]);
    focusWorkspace(item("a"));
    useReviewStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "something-else" });
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");
  });

  it("stages the intent when the attached branch is gone", () => {
    // Opening a review of a ref that no longer exists is worse than showing
    // nothing — and leaving the *previous* workspace's diff under this one's
    // name is worse still, so it lands on the empty state.
    seed([item("a")], [branch("something-else")]);
    focusWorkspace(item("a"));
    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
