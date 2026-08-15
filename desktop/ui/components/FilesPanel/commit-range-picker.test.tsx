import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

import { CommitRangePicker } from "./CommitRangePicker";
import { useReviewStore } from "../../stores";
import { makeComparison } from "../../types";
import type { CommitEntry, LocalBranchInfo } from "../../types";

const REPO = "/repo";

function commit(n: number): CommitEntry {
  return {
    hash: `sha${n}`,
    shortHash: `sha${n}`,
    message: `commit ${n}`,
    body: "",
  } as CommitEntry;
}

function branch(name: string, over: Partial<LocalBranchInfo>): LocalBranchInfo {
  return {
    name,
    isCurrent: false,
    commitsAhead: 0,
    unpushedCommits: 0,
    behindUpstream: 0,
    hasWorkingTreeChanges: false,
    lastCommitDate: new Date().toISOString(),
    lastCommitMessage: "x",
    lastCommitByUser: false,
    worktreePath: null,
    lastModifiedAt: null,
    workingTreeStats: null,
    ...over,
  };
}

/**
 * A branch of four commits against `main`, checked out here — the ordinary
 * shape, so each test only says what it changes about it.
 */
function seed(branches: LocalBranchInfo[]): void {
  useReviewStore.setState({
    repoPath: REPO,
    currentBranch: "feature",
    worktreePath: null,
    commitRange: null,
    reviewComparison: makeComparison("main", "feature"),
    attributionLoaded: true,
    attributionLoading: false,
    attribution: {
      commits: [commit(1), commit(2), commit(3), commit(4)],
      hunks: {},
    } as never,
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

function openMenu(): void {
  render(<CommitRangePicker />);
  fireEvent.pointerDown(
    screen.getByRole("button"),
    new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
  );
}

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    repoPath: null,
    currentBranch: null,
    commitRange: null,
    reviewComparison: null,
    attribution: null,
    attributionLoaded: false,
    localActivity: [],
    baseReason: null,
    reviewRef: null,
  });
  vi.clearAllMocks();
});

describe("the range picker's trigger", () => {
  /**
   * It used to read "All commits", which named the contents and left out what
   * they were being compared against — the half nobody could see, and the whole
   * of why a review reads bigger than expected.
   */
  it("names the base it is diffing against", () => {
    seed([branch("feature", { isCurrent: true })]);
    render(<CommitRangePicker />);

    expect(screen.getByRole("button").textContent).toContain(
      "Whole branch · vs main",
    );
  });

  it("names the picked slice instead once there is one", () => {
    seed([branch("feature", { isCurrent: true, unpushedCommits: 2 })]);
    useReviewStore.setState({
      commitRange: {
        kind: "commits",
        loOrdinal: 3,
        hiOrdinal: 4,
        title: "Unpushed · 2 commits",
        comparison: makeComparison("sha2", "sha4"),
      },
    });
    render(<CommitRangePicker />);

    expect(screen.getByRole("button").textContent).toContain(
      "Unpushed · 2 commits",
    );
  });
});

describe("the unpushed slice", () => {
  it("is offered when some but not all of the branch is unpushed", () => {
    seed([branch("feature", { isCurrent: true, unpushedCommits: 2 })]);
    openMenu();

    expect(screen.getByText("Unpushed")).toBeDefined();
    expect(screen.getByText("2 commits")).toBeDefined();
  });

  /** Nothing unpushed is no slice; everything unpushed is the whole branch. */
  it("is withheld when it would duplicate a row already there", () => {
    seed([branch("feature", { isCurrent: true, unpushedCommits: 0 })]);
    openMenu();
    expect(screen.queryByText("Unpushed")).toBeNull();

    cleanup();
    seed([branch("feature", { isCurrent: true, unpushedCommits: 4 })]);
    openMenu();
    expect(screen.queryByText("Unpushed")).toBeNull();
  });

  it("narrows the review to the commits off the end of the branch", () => {
    seed([branch("feature", { isCurrent: true, unpushedCommits: 2 })]);
    openMenu();

    fireEvent.click(screen.getByText("Unpushed"));

    // #3 and #4 — anchored at the commit before the range so #3's own change
    // is inside it.
    expect(useReviewStore.getState().commitRange?.comparison.key).toBe(
      "sha2..sha4",
    );
  });
});

describe("a stale base", () => {
  /**
   * The one fact that explains a file list nobody recognizes, and the one that
   * is invisible from inside the diff: everything that landed on trunk since
   * the local copy last moved is reachable from the branch, so it reads as the
   * branch's own work.
   */
  it("is reported when the base branch is behind its upstream", () => {
    seed([
      branch("feature", { isCurrent: true }),
      branch("main", { behindUpstream: 12 }),
    ]);
    openMenu();

    expect(screen.getByText(/commits behind on main/)).toBeDefined();
  });

  it("says nothing when the base is up to date", () => {
    seed([
      branch("feature", { isCurrent: true }),
      branch("main", { behindUpstream: 0 }),
    ]);
    openMenu();

    expect(screen.queryByText(/commits behind/)).toBeNull();
  });
});

describe("a pinned base", () => {
  /**
   * A pinned base is named for what it shows, not for the mechanism that set
   * it — "Whole branch · vs e14efa9" was two claims contradicting each other
   * in one line.
   */
  it("names itself by the commit it is pinned to", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({
      baseReason: "override",
      reviewComparison: makeComparison("e14efa9", "feature"),
    });
    render(<CommitRangePicker />);

    expect(screen.getByRole("button").textContent).toContain(
      "Since e14efa9 · pinned",
    );
  });

  /**
   * Escaping it is picking a different slice, not a verb of its own: the
   * override had no way out of the review screen at all, and adding "unpin"
   * would have been a fourth vocabulary for the one idea this menu unifies.
   */
  it("escapes by picking whole branch, which is what clearing it means", () => {
    const setBaseOverride = vi.fn().mockResolvedValue(null);
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({
      baseReason: "override",
      reviewRef: "feature",
      reviewComparison: makeComparison("e14efa9", "feature"),
      setBaseOverride,
    } as never);
    openMenu();

    fireEvent.click(screen.getByText("Whole branch"));

    expect(setBaseOverride).toHaveBeenCalledWith(REPO, "feature", null);
  });

  it("says nothing about pinning when the base was derived", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({ baseReason: "branchVsDefault" });
    openMenu();

    expect(screen.queryByText(/Unpin/)).toBeNull();
  });
});

describe("uncommitted work", () => {
  /**
   * Core diffs against the working tree whenever the head branch is checked
   * out, so uncommitted work is already inside the whole-branch view. Nothing
   * said so, and it is half of why a review reads bigger than the branch is.
   */
  it("is declared as part of the whole branch when it is folded in", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({ baseReason: "branchVsDefault" });
    openMenu();

    expect(
      screen.getByText("Uncommitted work is included in whole branch."),
    ).toBeDefined();
  });

  /**
   * The default branch against itself *is* its working tree. Offering
   * "uncommitted" beside it would be the same row twice, and the footnote
   * would be describing it as contained in itself.
   */
  it("is the whole of a trunk review, not a slice of one", () => {
    seed([branch("master", { isCurrent: true })]);
    useReviewStore.setState({
      baseReason: "trunkWorkingTree",
      currentBranch: "master",
      reviewComparison: makeComparison("master", "master"),
      attribution: { commits: [], hunks: {} } as never,
    });
    render(<CommitRangePicker />);

    // One slice and no commits: a static line, not a menu whose only row is
    // the row you are already on.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Uncommitted · master")).toBeDefined();
  });

  it("is not mentioned when the branch isn't checked out anywhere", () => {
    seed([branch("feature", {})]);
    useReviewStore.setState({ currentBranch: "something-else" });
    openMenu();

    expect(screen.queryByText(/Uncommitted work is included/)).toBeNull();
    expect(screen.queryByText("Uncommitted")).toBeNull();
  });

  /**
   * A trunk review collapses to the static line above — but a stale base is
   * the one thing still wrong about it, and that collapse must not swallow
   * the warning that says so.
   */
  it("still reports a stale base once collapsed to a static line", () => {
    seed([branch("master", { isCurrent: true, behindUpstream: 12 })]);
    useReviewStore.setState({
      baseReason: "trunkWorkingTree",
      currentBranch: "master",
      reviewComparison: makeComparison("master", "master"),
      attribution: { commits: [], hunks: {} } as never,
    });
    openMenu();

    expect(screen.getByText(/commits behind on master/)).toBeDefined();
  });
});
