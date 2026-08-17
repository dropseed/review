import { describe, it, expect } from "vitest";
import { describeWorkspace, type WorkspaceContext } from "./workspace-status";
import { makeReviewKey } from "../../utils/review-key";
import {
  attachment,
  localBranch as branch,
  viewerPr,
  workspace as makeWorkspace,
  workspaceContext,
} from "../../test/fixtures";
import type {
  LocalBranchInfo,
  ShippedPr,
  ViewerPr,
  Workspace,
} from "../../types";

const NOW = Date.UTC(2026, 0, 15);
const REPO = "/repo";

/** This suite's PR: `#12` on `feature`, in the repo every fixture here uses. */
function pr(overrides: Partial<ViewerPr> = {}): ViewerPr {
  return viewerPr({ repoPath: REPO, ...overrides });
}

/** A context built from the real tree, so the join can't drift from the rows. */
function context(
  branches: LocalBranchInfo[],
  prs: ViewerPr[] = [],
): WorkspaceContext {
  return workspaceContext({ repoPath: REPO, branches, prs });
}

function item(overrides: Partial<Workspace> = {}): Workspace {
  return makeWorkspace("one", {
    attachments: [attachment(REPO, "feature")],
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  });
}

describe("describeWorkspace", () => {
  it("describes a live workspace by its repos", () => {
    const status = describeWorkspace(
      item(),
      context([branch("main", { isCurrent: true }), branch("feature")]),
    );
    expect(status.subtitle).toContain("repo");
    expect(status.resolved).toBe(false);
  });

  it("resolves a card whose every branch is gone", () => {
    const status = describeWorkspace(item(), context([branch("main")]));
    expect(status.resolved).toBe(true);
    expect(status.subtitle).toContain("branch gone");
  });

  /**
   * What picking a PR up out of the drawer looks like for the second or two
   * the head is being fetched: the branch is attached and nothing local knows
   * it yet. Calling that "gone" would resolve a workspace the user just made.
   */
  it("does not call an unfetched PR's head branch gone", () => {
    const ctx = context([branch("main")], [pr({ headRefName: "feature" })]);
    const status = describeWorkspace(item(), ctx);
    expect(status.resolved).toBe(false);
    expect(status.repos[0].gone).toBe(false);
    // And it badges the PR straight away, from the same join.
    expect(status.openPr?.number).toBe(12);
  });

  it("does not resolve a repo nothing is known about", () => {
    // An unregistered repo has no rows because nothing looked, which is not
    // the same as a branch that was deleted.
    const ctx = context([branch("main")]);
    ctx.knownRepos.delete(REPO);
    expect(describeWorkspace(item(), ctx).resolved).toBe(false);
  });

  it("leads with the PR that wants something over one that doesn't", () => {
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "quiet"), attachment(REPO, "feature")],
      }),
      context(
        [branch("quiet"), branch("feature")],
        [
          pr({ number: 9, headRefName: "quiet" }),
          pr({ number: 12, reviewDecision: "CHANGES_REQUESTED" }),
        ],
      ),
    );
    expect(status.openPr?.number).toBe(12);
    expect(status.subtitle).toContain("#12 changes requested");
  });

  /** Each chip's PR is its own branch's, so a card can wear two numbers. */
  it("hands every attachment the PR its branch stands for", () => {
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "quiet"), attachment(REPO, "feature")],
      }),
      context(
        [branch("quiet"), branch("feature")],
        [pr({ number: 9, headRefName: "quiet" }), pr({ number: 12 })],
      ),
    );
    expect(status.repos.map((c) => c.openPr?.number)).toEqual([9, 12]);
  });

  /**
   * Dirtiness is a per-repo boolean, never a sum: the summed diffstat this
   * card used to report was a number that kept disagreeing with reality.
   */
  it("reports a dirty working tree as that branch's own boolean", () => {
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "feature"), attachment(REPO, "clean")],
      }),
      context([
        branch("feature", { hasWorkingTreeChanges: true }),
        branch("clean"),
      ]),
    );
    expect(status.repos.map((c) => c.hasChanges)).toEqual([true, false]);
  });

  it("says red CI in the subtitle, after the number", () => {
    const status = describeWorkspace(
      item(),
      context([branch("feature")], [pr({ checksState: "FAILURE" })]),
    );
    expect(status.subtitle).toContain("#12 CI failing");
  });

  it("labels each chip with the repo it belongs to", () => {
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "feature"), attachment("/other", "dev")],
      }),
      context([branch("feature")]),
    );
    expect(status.repos.map((c) => c.chipLabel)).toEqual([
      "repo · feature",
      "other · dev",
    ]);
    // The unknown repo's ref isn't gone, so the workspace isn't done.
    expect(status.resolved).toBe(false);
  });

  /**
   * An attachment with no ref is what the router hands a terminal started
   * outside any repository. It names no branch, so nothing can have deleted it
   * — treating it as gone would resolve a workspace that is still in use.
   */
  it("names a ref-less attachment by its directory and never calls it gone", () => {
    const status = describeWorkspace(
      item({ title: "", attachments: [attachment("/tmp/scratch")] }),
      context([]),
    );
    expect(status.repos[0].chipLabel).toBe("scratch");
    expect(status.resolved).toBe(false);
  });
});

function shippedPr(ref: string, overrides: Partial<ShippedPr> = {}): ShippedPr {
  return {
    number: 12,
    url: "https://github.com/o/repo/pull/12",
    title: "A change",
    mergedAt: new Date(NOW).toISOString(),
    repoPath: REPO,
    headRefName: ref,
    confirmedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

/** A context whose shipped index is keyed the way an attachment is. */
function shippedContext(
  branches: LocalBranchInfo[],
  merges: ShippedPr[],
  prs: ViewerPr[] = [],
): WorkspaceContext {
  const ctx = context(branches, prs);
  return {
    ...ctx,
    shipped: new Map(
      merges.map((pr) => [makeReviewKey(pr.repoPath, pr.headRefName), pr]),
    ),
  };
}

describe("shipped", () => {
  it("is the end of the story, and outranks the branch being gone", () => {
    // The branch is not in local activity — merged and deleted, which is the
    // shape this arrives in almost every time.
    const status = describeWorkspace(
      item(),
      shippedContext([branch("main")], [shippedPr("feature")]),
    );
    expect(status.shipped?.number).toBe(12);
    expect(status.subtitle).toContain("#12 merged");
    expect(status.resolved).toBe(true);
  });

  it("waits for every attached branch to land", () => {
    const both = item({
      attachments: [attachment(REPO, "feature"), attachment(REPO, "dev")],
    });
    const half = describeWorkspace(
      both,
      shippedContext(
        [branch("feature"), branch("dev")],
        [shippedPr("feature")],
      ),
    );
    expect(half.shipped).toBeUndefined();

    const all = describeWorkspace(
      both,
      shippedContext(
        [branch("feature"), branch("dev")],
        [
          shippedPr("feature", { number: 12 }),
          shippedPr("dev", {
            number: 13,
            mergedAt: new Date(NOW + 1000).toISOString(),
          }),
        ],
      ),
    );
    // The last one to land is the one the header names.
    expect(all.shipped?.number).toBe(13);
  });

  it("yields to a PR that is open again on the same branch", () => {
    const status = describeWorkspace(
      item(),
      shippedContext([branch("feature")], [shippedPr("feature")], [pr()]),
    );
    expect(status.shipped).toBeUndefined();
    expect(status.openPr?.number).toBe(12);
  });
});
