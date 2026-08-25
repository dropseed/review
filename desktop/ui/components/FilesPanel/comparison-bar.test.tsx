import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const api = vi.hoisted(() => ({
  listCommits: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(api, {
      get: (target, key) =>
        key in target
          ? target[key as keyof typeof target]
          : () => Promise.resolve(undefined),
    }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

import { ComparisonBar } from "./ComparisonBar";
import { TooltipProvider } from "../ui/tooltip";
import { useReviewStore } from "../../stores";
import { makeComparison } from "../../types";
import { REVIEW_VIEWPOINT } from "../../types/viewpoint";
import type { CommitEntry, LocalBranchInfo } from "../../types";
import type { CommitRange } from "../../types/commitRange";

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
    viewpoint: REVIEW_VIEWPOINT,
    comparison: makeComparison("main", "feature"),
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

/** The bar itself — the one control here that opens a menu. */
function trigger(): HTMLElement {
  return document.querySelector('[aria-haspopup="menu"]') as HTMLElement;
}

/** The range the bar just narrowed to, read off the viewpoint it set. */
function pickedRange(): CommitRange | null {
  const { viewpoint } = useReviewStore.getState();
  return viewpoint.kind === "range" ? viewpoint.range : null;
}

function openMenu(): void {
  render(
    <TooltipProvider>
      <ComparisonBar />
    </TooltipProvider>,
  );
  fireEvent.pointerDown(
    trigger(),
    new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
  );
}

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    repoPath: null,
    currentBranch: null,
    viewpoint: REVIEW_VIEWPOINT,
    comparison: null,
    reviewComparison: null,
    attribution: null,
    attributionLoaded: false,
    localActivity: [],
    baseReason: null,
    reviewRef: null,
  });
  vi.clearAllMocks();
});

describe("the bar's two lines", () => {
  /**
   * The base was visible only in the macOS window title: "All commits" named
   * the contents and left out what they were being compared against, which is
   * the half nobody could see and the whole of why a review reads bigger than
   * the branch is.
   */
  it("names the head on top and the base it is diffing against beneath", () => {
    seed([branch("feature", { isCurrent: true })]);
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );

    expect(screen.getByText("feature")).toBeDefined();
    expect(screen.getByText("working tree")).toBeDefined();
    expect(
      screen.getByText("vs main · whole branch · 4 commits"),
    ).toBeDefined();
  });

  it("names the picked slice instead once there is one", () => {
    seed([branch("feature", { isCurrent: true, unpushedCommits: 2 })]);
    useReviewStore.setState({
      viewpoint: {
        kind: "range",
        range: {
          kind: "commits",
          loOrdinal: 3,
          hiOrdinal: 4,
          title: "Unpushed · 2 commits",
          comparison: makeComparison("sha2", "sha4"),
        },
      },
      comparison: makeComparison("sha2", "sha4"),
    });
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );

    expect(screen.getByText("Unpushed · 2 commits")).toBeDefined();
    expect(screen.getByText("vs sha2 · 2 commits")).toBeDefined();
  });

  /**
   * A PR is reviewed at its fetched head against the base branch GitHub says
   * it targets, and the backend says so with `pullRequest`. The UI's table of
   * slice names didn't have that arm, so the lookup produced `undefined` and
   * reading its label took the whole window down the moment a PR was opened
   * from the sidebar.
   */
  it("names a pull request's own comparison", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({
      baseReason: "pullRequest",
      comparison: makeComparison("main", "refs/review/pr/7"),
      reviewComparison: makeComparison("main", "refs/review/pr/7"),
      currentBranch: "something-else",
    });
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );

    // Nobody calls it `refs/review/pr/7` out loud, and its head is not a
    // checkout — which is the fact the tag and the tint are there to carry.
    expect(screen.getByText("#7")).toBeDefined();
    expect(screen.getByText("PR")).toBeDefined();
    expect(screen.getByText("vs main · whole PR · 4 commits")).toBeDefined();
  });

  /**
   * The other direction of the same failure: a released app meeting a daemon
   * that has grown an arm it has never heard of. Mislabelling one line is a
   * bug; crashing on it is a category error.
   */
  it("falls back to a derived name rather than crashing on an unknown arm", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({
      baseReason: "somethingNewerThanThisApp" as never,
    });
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );

    expect(
      screen.getByText("vs main · whole branch · 4 commits"),
    ).toBeDefined();
  });

  /**
   * The way back lives where the "vs" sentence already is, rather than in a
   * banner above the diff: leaving a slice is a change of comparison like any
   * other, and it belongs beside the one being left.
   */
  it("offers the way back only while it is showing something else", () => {
    seed([branch("feature", { isCurrent: true })]);
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );
    expect(screen.queryByLabelText(/Back to/)).toBeNull();

    cleanup();
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({
      viewpoint: {
        kind: "commit",
        view: {
          hash: "d41c7ee",
          shortHash: "d41c7e",
          subject: "Collapse the revision states",
          comparison: makeComparison("d41c7ee^", "d41c7ee"),
          isMerge: false,
        },
      },
      comparison: makeComparison("d41c7ee^", "d41c7ee"),
    });
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );

    expect(
      screen.getByText("d41c7e Collapse the revision states"),
    ).toBeDefined();
    expect(screen.getByText("vs its parent")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Back to feature"));
    expect(useReviewStore.getState().viewpoint.kind).toBe("review");
  });

  /** The diff of a merge looks complete and isn't — the other parents' changes
   *  are simply not in it, and only the bar is left to say so. */
  it("says which parent a merge is being shown against", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({
      viewpoint: {
        kind: "commit",
        view: {
          hash: "m1",
          shortHash: "m1",
          subject: "Merge branch 'x'",
          comparison: makeComparison("m1^", "m1"),
          isMerge: true,
        },
      },
      comparison: makeComparison("m1^", "m1"),
    });
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );

    expect(
      screen.getByText(/merge shown against its first parent/),
    ).toBeDefined();
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
    expect(pickedRange()?.comparison.key).toBe("sha2..sha4");
  });
});

describe("the branch's commits", () => {
  /** A log reads newest first; the ordinals a range is expressed in count from
   *  the oldest, which is the branch's own narrative order. */
  it("are listed like a log and narrow the review when picked", () => {
    seed([branch("feature", { isCurrent: true })]);
    openMenu();

    // Hash then subject, newest first.
    const rows = screen.getAllByText(/^commit \d$/).map((el) => el.textContent);
    expect(rows).toEqual([
      "sha4commit 4",
      "sha3commit 3",
      "sha2commit 2",
      "sha1commit 1",
    ]);

    fireEvent.click(screen.getByText("commit 3"));

    // The commit before it is the base, so #3's own change is inside the range
    // rather than being used as its baseline.
    expect(pickedRange()?.comparison.key).toBe("sha2..sha3");
  });

  it("extend to a range on shift-click, anchored at what is already picked", () => {
    seed([branch("feature", { isCurrent: true })]);
    openMenu();
    fireEvent.click(screen.getByText("commit 2"));

    cleanup();
    openMenu();
    fireEvent.click(screen.getByText("commit 4"), { shiftKey: true });

    expect(pickedRange()?.comparison.key).toBe("sha1..sha4");
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

  /**
   * A trunk review has no commits and one slice, so it is the emptiest this
   * menu ever gets — and a stale base is the one thing it can still be wrong
   * about. Nothing about that quietness may swallow the warning.
   */
  it("is still reported on a review with nothing else to choose", () => {
    seed([branch("master", { isCurrent: true, behindUpstream: 12 })]);
    useReviewStore.setState({
      baseReason: "trunkWorkingTree",
      currentBranch: "master",
      comparison: makeComparison("master", "master"),
      reviewComparison: makeComparison("master", "master"),
      attribution: { commits: [], hunks: {} } as never,
    });
    openMenu();

    expect(screen.getByText(/commits behind on master/)).toBeDefined();
  });
});

describe("a pinned base", () => {
  /**
   * A pinned base is named for what it shows, not for the mechanism that set
   * it — "Whole branch · vs e14efa9" was two claims contradicting each other
   * in one line. The commit count is the staleness signal: a pin set weeks ago
   * keeps accumulating, and "pinned" alone never said how far it had drifted.
   */
  it("names itself by the commit it is pinned to, and how far it has grown", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({
      baseReason: "override",
      comparison: makeComparison("e14efa9", "feature"),
      reviewComparison: makeComparison("e14efa9", "feature"),
    });
    render(
      <TooltipProvider>
        <ComparisonBar />
      </TooltipProvider>,
    );

    expect(screen.getByText("vs e14efa9 · pinned · 4 commits")).toBeDefined();
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
      comparison: makeComparison("e14efa9", "feature"),
      reviewComparison: makeComparison("e14efa9", "feature"),
      setBaseOverride,
    } as never);
    openMenu();

    fireEvent.click(screen.getByText("Whole branch"));

    expect(setBaseOverride).toHaveBeenCalledWith(REPO, "feature", null);
  });

  /**
   * Clearing a *trunk* pin lands on the working tree (the ladder's trunk arm),
   * not "whole branch vs itself" — so the escape row is named for where it
   * lands, and the narrowing "Uncommitted" row is absorbed into it rather
   * than rendering the same words twice with different mechanics.
   */
  it("escapes a trunk pin by picking uncommitted, where clearing lands", () => {
    const setBaseOverride = vi.fn().mockResolvedValue(null);
    seed([branch("main", { isCurrent: true })]);
    useReviewStore.setState({
      currentBranch: "main",
      baseReason: "override",
      reviewRef: "main",
      comparison: makeComparison("e14efa9", "main"),
      reviewComparison: makeComparison("e14efa9", "main"),
      setBaseOverride,
    } as never);
    openMenu();

    expect(screen.queryByText("Whole branch")).toBeNull();
    const rows = screen.getAllByText("Uncommitted");
    expect(rows).toHaveLength(1);
    fireEvent.click(rows[0]);

    expect(setBaseOverride).toHaveBeenCalledWith(REPO, "main", null);
  });

  it("says nothing about pinning when the base was derived", () => {
    seed([branch("feature", { isCurrent: true })]);
    useReviewStore.setState({ baseReason: "branchVsDefault" });
    openMenu();

    expect(screen.queryByText(/pinned/)).toBeNull();
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
      comparison: makeComparison("master", "master"),
      reviewComparison: makeComparison("master", "master"),
      attribution: { commits: [], hunks: {} } as never,
    });
    openMenu();

    expect(screen.getByText("uncommitted changes")).toBeDefined();
    expect(screen.getAllByText("Uncommitted")).toHaveLength(1);
    expect(screen.queryByText(/Uncommitted work is included/)).toBeNull();
  });

  it("is not mentioned when the branch isn't checked out anywhere", () => {
    seed([branch("feature", {})]);
    useReviewStore.setState({ currentBranch: "something-else" });
    openMenu();

    expect(screen.queryByText(/Uncommitted work is included/)).toBeNull();
    expect(screen.queryByText("Uncommitted")).toBeNull();
  });
});
