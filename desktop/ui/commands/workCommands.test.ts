import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("../api", () => ({
  getApiClient: () => ({ listWorkItems: vi.fn().mockResolvedValue([]) }),
}));

const activateReviewKey = vi.fn();
vi.mock("./host", () => ({
  getCommandUi: () => ({ activateReviewKey }),
}));

import { activateWorkItem, workCommands } from "./workCommands";
import { useReviewStore } from "../stores";
import { toAccelerator } from "./shortcuts";
import type { LocalBranchInfo, WorkItem } from "../types";

const REPO = "/repo";

function item(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: "",
    refs: [{ repoPath: REPO, ref: "feature" }],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
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

function seed(items: WorkItem[], branches = [branch("feature")]): void {
  useReviewStore.setState({
    workItems: items,
    localActivity: [
      {
        repoPath: REPO,
        repoName: "repo",
        defaultBranch: "main",
        branches,
        recentRemoteBranches: [],
      },
    ],
  });
}

afterEach(() => {
  useReviewStore.setState({ workItems: [], localActivity: [] });
  vi.clearAllMocks();
});

describe("⌘1–9 over the work queue", () => {
  it("binds the digits to the first nine cards, in the user's order", () => {
    seed(Array.from({ length: 11 }, (_, i) => item(`w${i}`)));
    const accelerators = workCommands().map((c) =>
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

  it("titles a card by its own name, falling back to the ref it holds", () => {
    seed([item("a", { title: "Ship the thing" }), item("b")]);
    expect(workCommands().map((c) => c.title)).toEqual([
      "Ship the thing",
      "feature",
    ]);
  });

  it("opens the card's first ref", () => {
    seed([item("a")]);
    activateWorkItem(item("a"));
    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
  });

  it("does nothing for a note, which has nowhere to go", () => {
    seed([item("a", { refs: [] })]);
    activateWorkItem(item("a", { refs: [] }));
    expect(activateReviewKey).not.toHaveBeenCalled();
  });

  it("does nothing when the bound branch is gone", () => {
    // Opening a review of a ref that no longer exists is worse than staying
    // put — the card keeps its place and says so instead.
    seed([item("a")], [branch("something-else")]);
    activateWorkItem(item("a"));
    expect(activateReviewKey).not.toHaveBeenCalled();
  });
});
