import { describe, expect, it } from "vitest";
import { refFromReviewPath, refFromUrlSegment } from "./useRepositoryInit";

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
