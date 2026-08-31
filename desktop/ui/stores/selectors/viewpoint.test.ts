import { describe, it, expect } from "vitest";
import { makeComparison } from "../../types";
import type { SpurStore } from "../types";
import { headIsWorkingTree, isCheckedOut } from "./checkout";
import {
  activeHistoricRef,
  ephemeralView,
  historicRef,
  viewOnly,
} from "./viewpoint";

/** The fields these selectors read, and nothing else. */
function state(over: Partial<SpurStore>): SpurStore {
  return {
    viewpoint: { kind: "review" },
    comparison: makeComparison("main", "feature"),
    reviewComparison: makeComparison("main", "feature"),
    currentBranch: null,
    gitStatus: null,
    worktreePath: null,
    readOnlyPreview: false,
    filesPanelTab: "changes",
    ...over,
  } as SpurStore;
}

const status = (branch: string) =>
  ({
    currentBranch: branch,
    staged: [],
    unstaged: [],
    untracked: [],
    indexLocked: false,
  }) as SpurStore["gitStatus"];

const peek = {
  kind: "commit" as const,
  view: {
    hash: "abc1234",
    shortHash: "abc1234",
    subject: "a commit",
    comparison: makeComparison("abc1234^", "abc1234"),
    isMerge: false,
  },
};

const narrowed = {
  kind: "range" as const,
  range: {
    kind: "commits" as const,
    loOrdinal: 1,
    hiOrdinal: 1,
    title: "#1",
    comparison: makeComparison("main", "sha1"),
  },
};

describe("reading a viewpoint", () => {
  it("answers its one question and null for the other kinds", () => {
    expect(ephemeralView(state({ viewpoint: peek }))).toBe(peek.view);
    expect(ephemeralView(state({ viewpoint: narrowed }))).toBeNull();
    expect(ephemeralView(state({}))).toBeNull();
  });
});

describe("headIsWorkingTree", () => {
  it("is true when the head is the branch checked out here", () => {
    expect(headIsWorkingTree(state({ gitStatus: status("feature") }))).toBe(
      true,
    );
    expect(headIsWorkingTree(state({ gitStatus: status("main") }))).toBe(false);
  });

  it("falls back to the branch browse mode loads", () => {
    // A review gets its branch from the git status it loads anyway;
    // `currentBranch` is only fetched by browse and standalone mode.
    expect(headIsWorkingTree(state({ currentBranch: "feature" }))).toBe(true);
  });

  it("counts the linked worktree a review owns", () => {
    // The whole point of the widening: a branch checked out in a worktree
    // rather than here still has a working tree to act against.
    expect(
      headIsWorkingTree(
        state({
          gitStatus: status("main"),
          worktreePath: "/wt",
          reviewComparison: makeComparison("main", "feature"),
        }),
      ),
    ).toBe(true);
  });

  it("counts it for the review's own head and nothing else", () => {
    // A worktree has one revision checked out. A commit peeked at inside a
    // materialized review is no more checked out than it would be without
    // one — and the Git tab that arm used to enable would have staged against
    // the branch while the diff on screen was of a commit.
    expect(
      headIsWorkingTree(
        state({
          viewpoint: peek,
          comparison: peek.view.comparison,
          gitStatus: status("main"),
          worktreePath: "/wt",
          reviewComparison: makeComparison("main", "feature"),
        }),
      ),
    ).toBe(false);
  });

  it("is false with no comparison at all", () => {
    expect(headIsWorkingTree(state({ comparison: null }))).toBe(false);
  });

  /**
   * Which comparison to ask about is the caller's. The comparison bar asks it
   * of `reviewComparison` — offering "uncommitted changes" is about the branch
   * the review is of, not whichever slice of it is on screen.
   */
  it("answers about whichever comparison is asked about", () => {
    const peeking = state({
      viewpoint: peek,
      comparison: peek.view.comparison,
      gitStatus: status("feature"),
    });
    expect(isCheckedOut(peeking, peeking.comparison)).toBe(false);
    expect(isCheckedOut(peeking, peeking.reviewComparison)).toBe(true);
  });
});

describe("the revision Browse reads at", () => {
  it("is the working tree when the head is checked out", () => {
    expect(historicRef(state({ gitStatus: status("feature") }))).toBeNull();
  });

  it("is the head on screen when nothing has it checked out", () => {
    expect(historicRef(state({ gitStatus: status("main") }))).toBe("feature");
  });

  it("follows the viewpoint, so the tree agrees with the diff beside it", () => {
    expect(
      historicRef(state({ viewpoint: peek, comparison: peek.view.comparison })),
    ).toBe("abc1234");
  });

  it("only counts as a surface while Browse is the tab on screen", () => {
    const off = state({ gitStatus: status("main") });
    expect(activeHistoricRef(off)).toBeNull();
    expect(activeHistoricRef({ ...off, filesPanelTab: "browse" })).toBe(
      "feature",
    );
  });
});

describe("viewOnly", () => {
  it("is the union of the three ways to be looking rather than reviewing", () => {
    expect(viewOnly(state({ gitStatus: status("feature") }))).toBe(false);
    expect(viewOnly(state({ readOnlyPreview: true }))).toBe(true);
    expect(viewOnly(state({ viewpoint: peek }))).toBe(true);
    expect(
      viewOnly(state({ gitStatus: status("main"), filesPanelTab: "browse" })),
    ).toBe(true);
  });

  it("is false for a narrowing, which is still the review", () => {
    expect(
      viewOnly(
        state({
          viewpoint: narrowed,
          comparison: narrowed.range.comparison,
          worktreePath: "/wt",
        }),
      ),
    ).toBe(false);
  });
});
