import { describe, it, expect } from "vitest";
import { prBadgeClass, prSummary, samePrBadge } from "./pr-format";
import type { ViewerPr } from "../../types";

function pr(overrides: Partial<ViewerPr> = {}): ViewerPr {
  return {
    number: 97,
    title: "Add the thing",
    url: "https://github.com/o/r/pull/97",
    isDraft: false,
    updatedAt: "2026-01-20T00:00:00Z",
    headRefName: "feature",
    baseRefName: "main",
    repoNameWithOwner: "o/r",
    repoUrl: "https://github.com/o/r",
    headRepoNameWithOwner: "o/r",
    reviewDecision: null,
    checksState: null,
    repoPath: "/r",
    ...overrides,
  };
}

describe("prBadgeClass", () => {
  it("goes red for requested changes or a CI failure", () => {
    expect(prBadgeClass(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe(
      "text-pr-attention",
    );
    expect(prBadgeClass(pr({ checksState: "FAILURE" }))).toBe(
      "text-pr-attention",
    );
    // A check that couldn't run is not a check that passed.
    expect(prBadgeClass(pr({ checksState: "ERROR" }))).toBe(
      "text-pr-attention",
    );
  });

  it("keeps a red draft red", () => {
    // The draft colour is the quiet one, so applying it first would hide
    // exactly the drafts worth noticing.
    expect(prBadgeClass(pr({ isDraft: true, checksState: "FAILURE" }))).toBe(
      "text-pr-attention",
    );
  });

  it("greys a draft and greens everything else", () => {
    expect(prBadgeClass(pr({ isDraft: true }))).toBe("text-pr-draft");
    expect(prBadgeClass(pr())).toBe("text-pr-open");
  });

  it("paints approved the same green as plain open, like GitHub does", () => {
    expect(prBadgeClass(pr({ reviewDecision: "APPROVED" }))).toBe(
      "text-pr-open",
    );
    // …but a green review decision never outranks red CI.
    expect(
      prBadgeClass(pr({ reviewDecision: "APPROVED", checksState: "FAILURE" })),
    ).toBe("text-pr-attention");
  });

  it("still says open when checks are merely pending or unreported", () => {
    expect(prBadgeClass(pr({ checksState: "PENDING" }))).toBe("text-pr-open");
    expect(prBadgeClass(pr({ checksState: null }))).toBe("text-pr-open");
  });
});

describe("samePrBadge", () => {
  it("ignores everything the badge doesn't draw", () => {
    // The poll rebuilds every PR object, and fields like updatedAt move on
    // their own. A row that re-rendered for those would re-render constantly.
    expect(
      samePrBadge(
        pr(),
        pr({ updatedAt: "2026-02-01T00:00:00Z", title: "New" }),
      ),
    ).toBe(true);
  });

  it("notices each state the badge does draw", () => {
    expect(samePrBadge(pr(), pr({ number: 98 }))).toBe(false);
    expect(samePrBadge(pr(), pr({ isDraft: true }))).toBe(false);
    expect(samePrBadge(pr(), pr({ reviewDecision: "APPROVED" }))).toBe(false);
    expect(samePrBadge(pr(), pr({ checksState: "FAILURE" }))).toBe(false);
  });

  it("treats a PR appearing or disappearing as a change", () => {
    expect(samePrBadge(undefined, undefined)).toBe(true);
    expect(samePrBadge(undefined, pr())).toBe(false);
    expect(samePrBadge(pr(), undefined)).toBe(false);
  });
});

describe("prSummary", () => {
  it("composes the parts that apply", () => {
    expect(
      prSummary(
        pr({
          isDraft: true,
          reviewDecision: "CHANGES_REQUESTED",
          checksState: "FAILURE",
        }),
      ),
    ).toBe("#97 · Draft · Changes requested · CI failing");
  });

  it("says only the number when there is nothing else to say", () => {
    expect(prSummary(pr())).toBe("#97");
  });

  it("omits states it has no honest label for", () => {
    // `EXPECTED` is a check that was announced and never ran — not news, and
    // "unknown" would read as a problem.
    expect(prSummary(pr({ checksState: "EXPECTED" }))).toBe("#97");
  });
});
