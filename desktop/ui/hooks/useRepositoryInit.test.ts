import { describe, expect, it } from "vitest";
import {
  insideReview,
  insideRoute,
  refFromReviewPath,
  refFromUrlSegment,
  showingComparison,
} from "./useRepositoryInit";
import { REVIEW_VIEWPOINT } from "../types/viewpoint";
import type { Viewpoint } from "../types/viewpoint";
import type { ActiveReviewKey } from "../stores/slices/tabRailSlice";
import type { Comparison } from "../types";

describe("refFromReviewPath", () => {
  it("reads the ref off a bare review URL", () => {
    expect(refFromReviewPath("/dropseed/spur/review/master")).toBe("master");
  });

  /**
   * The regression this exists for. The match used to be anchored to the end of
   * the path, so a link *into a file* produced no ref at all — the default
   * branch was resolved instead and the file segment was dropped, which is
   * every shared link and every cold start of the installed app.
   */
  it("reads the ref off a URL that continues into a file", () => {
    expect(
      refFromReviewPath("/dropseed/spur/review/master/file/core/src/lib.rs"),
    ).toBe("master");
  });

  /**
   * And why the bug survived a hand check: on the checked-out branch the
   * fallback happens to return the same ref, so the only case that reveals it
   * is a branch that isn't the default one.
   */
  it("reads a non-default branch off a file URL", () => {
    expect(
      refFromReviewPath("/dropseed/spur/review/feature-x/file/README.md"),
    ).toBe("feature-x");
  });

  it("decodes a ref that had to be encoded to fit in one segment", () => {
    expect(
      refFromReviewPath("/dropseed/spur/review/feature%2Flogin/file/a.ts"),
    ).toBe("feature/login");
    expect(refFromReviewPath("/o/r/review/release%2Fv1.2")).toBe(
      "release/v1.2",
    );
  });

  it("names no ref for routes that carry none", () => {
    expect(refFromReviewPath("/dropseed/spur/browse/core/src/lib.rs")).toBe(
      null,
    );
    expect(refFromReviewPath("/standalone/browse/x.ts")).toBe(null);
    expect(refFromReviewPath("/")).toBe(null);
    expect(refFromReviewPath("")).toBe(null);
  });

  /** A repo literally called "review" must not be mistaken for the route. */
  it("takes the segment after /review/, not a repo of that name", () => {
    expect(refFromReviewPath("/dropseed/spur/review/master")).toBe("master");
  });
});

describe("refFromUrlSegment", () => {
  it("decodes a segment, and treats empty as absent", () => {
    expect(refFromUrlSegment("feature%2Flogin")).toBe("feature/login");
    expect(refFromUrlSegment("master")).toBe("master");
    expect(refFromUrlSegment("")).toBe(null);
    expect(refFromUrlSegment(null)).toBe(null);
  });

  /** A stray `%` is a bad escape, not a reason to lose the ref. */
  it("keeps a segment that cannot be decoded", () => {
    expect(refFromUrlSegment("100%branch")).toBe("100%branch");
  });
});

const REPO = "/repos/spur";
const COMPARISON: Comparison = {
  base: "main",
  head: "feature",
  key: "main..feature",
};

function state(
  overrides: {
    repoPath?: string | null;
    activeReviewKey?: ActiveReviewKey | null;
    comparison?: Comparison | null;
    viewpoint?: Viewpoint;
  } = {},
) {
  return {
    repoPath: REPO,
    activeReviewKey: { repoPath: REPO, ref: "feature", path: REPO },
    comparison: COMPARISON,
    viewpoint: REVIEW_VIEWPOINT,
    ...overrides,
  };
}

/**
 * The predicate that decides whether a click has anything left to do. Its
 * whole point is what it *refuses* to call a match: every false here is a
 * screen that would otherwise be left showing the wrong thing, and every true
 * is a comparison rebuilt for nothing.
 */
describe("showingComparison", () => {
  it("recognizes the comparison already on screen", () => {
    expect(showingComparison(state(), REPO, "feature")).toBe(true);
  });

  it("is another branch, and another repo, when either differs", () => {
    expect(showingComparison(state(), REPO, "other")).toBe(false);
    expect(showingComparison(state(), "/repos/other", "feature")).toBe(false);
  });

  /** The key can name a review the store has already begun to swap away from. */
  it("needs the loaded repo to be that repo too", () => {
    expect(
      showingComparison(state({ repoPath: "/repos/other" }), REPO, "feature"),
    ).toBe(false);
  });

  it("is nothing at all with no comparison loaded", () => {
    expect(
      showingComparison(state({ comparison: null }), REPO, "feature"),
    ).toBe(false);
    expect(
      showingComparison(state({ activeReviewKey: null }), REPO, "feature"),
    ).toBe(false);
  });

  /**
   * A peek renders a comparison the review isn't of while the key still names
   * the branch — clicking the branch is how you come back from one, so it must
   * not be mistaken for already being there.
   */
  it("does not count a commit peek as showing the review", () => {
    const peek: Viewpoint = {
      kind: "commit",
      view: {
        hash: "abc123",
        shortHash: "abc123",
        subject: "a commit",
        comparison: { base: "abc122", head: "abc123", key: "abc122..abc123" },
        isMerge: false,
      },
    };
    expect(showingComparison(state({ viewpoint: peek }), REPO, "feature")).toBe(
      false,
    );
  });

  /** A narrowing stays attached to the review, so it is still that review. */
  it("counts a narrowed range as showing the review", () => {
    const range: Viewpoint = {
      kind: "range",
      range: {
        kind: "commits",
        loOrdinal: 1,
        hiOrdinal: 2,
        title: "2 commits",
        comparison: { base: "abc", head: "def", key: "abc..def" },
      },
    };
    expect(
      showingComparison(state({ viewpoint: range }), REPO, "feature"),
    ).toBe(true);
  });
});

describe("insideReview", () => {
  it("holds anywhere inside the review's own route", () => {
    expect(insideReview("/dropseed/spur/review/feature", "feature")).toBe(true);
    expect(
      insideReview("/dropseed/spur/review/feature/file/src/main.rs", "feature"),
    ).toBe(true);
  });

  it("does not hold on another ref, or off the review routes entirely", () => {
    expect(insideReview("/dropseed/spur/review/main", "feature")).toBe(false);
    expect(insideReview("/dropseed/spur/browse", "feature")).toBe(false);
    expect(insideReview("/", "feature")).toBe(false);
  });
});

describe("insideRoute", () => {
  it("holds on the route and on what it contains", () => {
    expect(insideRoute("/standalone/browse", "/standalone/browse")).toBe(true);
    expect(
      insideRoute("/standalone/browse/file/notes.md", "/standalone/browse"),
    ).toBe(true);
  });

  /** A sibling that merely starts with the same characters is not inside it. */
  it("does not hold on a neighbouring route", () => {
    expect(insideRoute("/standalone/browsers", "/standalone/browse")).toBe(
      false,
    );
    expect(insideRoute("/", "/standalone/browse")).toBe(false);
  });
});
