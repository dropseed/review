import { describe, it, expect } from "vitest";
import { drawerEmptyMessage, drawerPrs } from "./pr-drawer";
import {
  attachment,
  localBranch,
  viewerPr,
  viewerPrSnapshot,
  workspace,
  workspaceContext,
} from "../../test/fixtures";
import type { ViewerPr, ViewerPrSnapshot, Workspace } from "../../types";

const REPO = "/repo";
const NO_FILTER: string[] = [];

/** The queue, as a list of one-repo workspaces. */
function queue(...refs: string[]): Workspace[] {
  return refs.map((ref, i) =>
    workspace(`w${i}`, { attachments: [attachment(REPO, ref)] }),
  );
}

function shownNumbers(
  snapshot: ViewerPrSnapshot,
  prs: ViewerPr[],
  branches: string[],
  workspaces: Workspace[] = [],
  hidden: string[] = NO_FILTER,
): number[] {
  const ctx = workspaceContext({
    repoPath: REPO,
    branches: branches.map((name) => localBranch(name)),
    prs,
  });
  return drawerPrs(snapshot, workspaces, ctx, hidden).shown.map(
    (p) => p.number,
  );
}

describe("drawerPrs", () => {
  it("drops a PR whose branch a workspace is attached to", () => {
    const prs = [viewerPr()];
    expect(
      shownNumbers(viewerPrSnapshot(prs), prs, ["feature"], queue("feature")),
    ).toEqual([]);
  });

  it("drops one whose head has never been fetched", () => {
    // The whole point of picking a PR up: the attachment lands before the
    // branch does, and the drawer must stop listing it immediately or the row
    // sits there for as long as the fetch takes.
    const prs = [viewerPr()];
    expect(
      shownNumbers(viewerPrSnapshot(prs), prs, ["main"], queue("feature")),
    ).toEqual([]);
  });

  it("keeps a PR on another branch of the same repo", () => {
    const prs = [viewerPr(), viewerPr({ number: 13, headRefName: "other" })];
    expect(
      shownNumbers(
        viewerPrSnapshot(prs),
        prs,
        ["feature", "other"],
        queue("feature"),
      ),
    ).toEqual([13]);
  });

  it("puts changes-requested first and drafts last", () => {
    const older = new Date(Date.UTC(2026, 0, 14)).toISOString();
    const prs = [
      viewerPr({ number: 1, headRefName: "a" }),
      viewerPr({ number: 2, headRefName: "b", isDraft: true }),
      viewerPr({
        number: 3,
        headRefName: "c",
        reviewDecision: "CHANGES_REQUESTED",
        updatedAt: older,
      }),
      viewerPr({ number: 4, headRefName: "d", updatedAt: older }),
    ];
    expect(shownNumbers(viewerPrSnapshot(prs), prs, [])).toEqual([3, 1, 4, 2]);
  });

  it("does not rank red CI above anything", () => {
    // CI is reported, not ranked — see `prNeedsAttention`. Recency alone
    // orders these.
    const older = new Date(Date.UTC(2026, 0, 14)).toISOString();
    const prs = [
      viewerPr({ number: 1, headRefName: "a" }),
      viewerPr({
        number: 2,
        headRefName: "b",
        checksState: "FAILURE",
        updatedAt: older,
      }),
    ];
    expect(shownNumbers(viewerPrSnapshot(prs), prs, [])).toEqual([1, 2]);
  });

  it("hides a filtered repo, counts what it hid, and still offers it back", () => {
    const prs = [
      viewerPr({ number: 1, headRefName: "a" }),
      viewerPr({
        number: 2,
        headRefName: "b",
        repoNameWithOwner: "o/noisy",
        repoPath: null,
      }),
      viewerPr({
        number: 3,
        headRefName: "c",
        repoNameWithOwner: "o/noisy",
        repoPath: null,
      }),
    ];
    const result = drawerPrs(
      viewerPrSnapshot(prs),
      [],
      workspaceContext({ repoPath: REPO, prs }),
      ["o/noisy"],
    );
    expect(result.shown.map((p) => p.number)).toEqual([1]);
    expect(result.hidden).toBe(2);
    // Listed with its count even while filtered out — otherwise there is no
    // way back from having silenced it.
    expect(result.repos).toEqual([
      { repo: "o/noisy", count: 2 },
      { repo: "o/repo", count: 1 },
    ]);
  });

  it("counts a repo by what is left to pick up, not by what GitHub has", () => {
    const prs = [viewerPr(), viewerPr({ number: 13, headRefName: "other" })];
    const ctx = workspaceContext({
      repoPath: REPO,
      branches: [localBranch("feature"), localBranch("other")],
      prs,
    });
    const result = drawerPrs(viewerPrSnapshot(prs), queue("feature"), ctx, []);
    expect(result.repos).toEqual([{ repo: "o/repo", count: 1 }]);
  });

  it("shows nothing at all when gh isn't usable here", () => {
    // `available: false` still carries the last cached PRs — rendering them
    // would paint rows for a user who has been told nothing is wrong.
    const prs = [viewerPr()];
    expect(
      shownNumbers(viewerPrSnapshot(prs, { available: false }), prs, []),
    ).toEqual([]);
  });

  it("keeps the last known PRs when a refresh failed", () => {
    const prs = [viewerPr()];
    expect(
      shownNumbers(viewerPrSnapshot(prs, { error: "gh: timed out" }), prs, []),
    ).toEqual([12]);
  });
});

describe("drawerEmptyMessage", () => {
  it("tells 'not checked yet' apart from 'nothing open'", () => {
    expect(drawerEmptyMessage(null)).toContain("Checking");
    expect(drawerEmptyMessage(viewerPrSnapshot([]))).toContain("No open");
  });

  it("says so when the queue has them all", () => {
    expect(drawerEmptyMessage(viewerPrSnapshot([viewerPr()]))).toContain(
      "in the queue",
    );
  });
});
