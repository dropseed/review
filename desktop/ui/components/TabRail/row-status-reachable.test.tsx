import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { GlobalReviewSummary, TerminalSessionInfo } from "../../types";

// Hoisted: the store's module initializer calls getApiClient(), which runs
// before a plain `const` mock would be initialized.
const { terminalPeek } = vi.hoisted(() => ({
  terminalPeek: vi.fn<(id: string) => Promise<string>>(),
}));

vi.mock("../../api", () => ({
  getApiClient: () => ({ terminalPeek }),
}));

import { TabRailItem } from "./TabRailItem";
import { LocalBranchItem } from "./LocalBranchItem";
import { useReviewStore } from "../../stores";

const REPO = "/repo";

function session(id: string, cwd: string): TerminalSessionInfo {
  return {
    id,
    repoPath: REPO,
    cwd,
    title: null,
    cols: 80,
    rows: 24,
    status: {
      id,
      phase: "idle",
      runningCommand: null,
      lastExitCode: 0,
      cwd,
      title: null,
      enteredStateAt: Date.now(),
      shellIntegrationActive: true,
    },
  };
}

function seedTerminal(cwd: string): void {
  const s = session("t1", cwd);
  useReviewStore.setState({
    terminalSessions: { t1: s },
    terminalStatuses: { t1: s.status },
  });
}

function reviewSummary(worktreePath: string): GlobalReviewSummary {
  return {
    repoPath: REPO,
    repoName: "repo",
    ref: "feature",
    tier: "materialized",
    totalHunks: 3,
    trustedHunks: 0,
    approvedHunks: 0,
    reviewedHunks: 0,
    rejectedHunks: 0,
    savedForLaterHunks: 0,
    state: null,
    updatedAt: new Date().toISOString(),
    worktreePath,
  };
}

/**
 * The classes that make an element vanish while the pointer is on its row.
 * Anything between a click target and the row must carry neither: the pointer
 * has to be on the row to reach the target, so hiding on hover means it can
 * never be reached at all.
 */
const HOVER_HIDES = /group-hover:(opacity-0|pointer-events-none)/;

function hoverHidingAncestors(el: HTMLElement): string[] {
  const offenders: string[] = [];
  for (
    let node: HTMLElement | null = el;
    node != null && node !== document.body;
    node = node.parentElement
  ) {
    if (HOVER_HIDES.test(node.className)) offenders.push(node.className);
  }
  return offenders;
}

beforeEach(() => {
  terminalPeek.mockResolvedValue("");
});

afterEach(() => {
  cleanup();
  useReviewStore.setState({ terminalSessions: {}, terminalStatuses: {} });
  vi.clearAllMocks();
});

describe("the terminal badge survives hovering its row", () => {
  it("stays reachable on a review row, alongside the hover actions", () => {
    seedTerminal("/wt/feature");
    render(
      <TabRailItem
        review={reviewSummary("/wt/feature")}
        repoName="repo"
        defaultBranch="main"
        onActivate={() => {}}
        onDelete={() => {}}
        checkouts={[REPO, "/wt/feature"]}
      />,
    );

    const badge = screen.getByRole("button", { name: /1 terminal/ });
    expect(hoverHidingAncestors(badge)).toEqual([]);
    // The actions the fade was making room for still appear on hover.
    expect(screen.getByRole("button", { name: "Review options" })).toBeTruthy();
  });

  it("stays reachable on a worktree row, alongside the hover actions", () => {
    seedTerminal("/wt/feature");
    render(
      <LocalBranchItem
        branch={{
          name: "feature",
          isCurrent: false,
          commitsAhead: 1,
          hasWorkingTreeChanges: false,
          lastCommitDate: new Date().toISOString(),
          lastCommitMessage: "wip",
          lastCommitByUser: true,
          worktreePath: "/wt/feature",
          lastModifiedAt: null,
          workingTreeStats: null,
        }}
        repoPath={REPO}
        defaultBranch="main"
        itemKind="worktree"
        checkoutPath="/wt/feature"
        onActivate={() => {}}
        checkouts={[REPO, "/wt/feature"]}
      />,
    );

    const badge = screen.getByRole("button", { name: /1 terminal/ });
    expect(hoverHidingAncestors(badge)).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Remove worktree" }),
    ).toBeTruthy();
  });
});
