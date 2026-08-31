import { vi, describe, it, expect, afterEach } from "vitest";
import type { Attachment, LocalBranchInfo, Workspace } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({ listWorkspaces: vi.fn().mockResolvedValue([]) }),
}));

import { openTerminalTab } from "./newTab";
import { useSpurStore } from "../../stores";
import { attachment, workspace as makeWorkspace } from "../../test/fixtures";

const REPO = "/repo";
const OTHER = "/other-repo";

/** Records what `openTerminalTab` asked the backend to start. */
const started: {
  repoPath: string;
  cwd: string;
  workspaceId?: string;
}[] = [];

function stubStartTerminal(id: string | null = "session-1"): void {
  useSpurStore.setState({
    startTerminal: async (repoPath, cwd, _cols, _rows, _shell, workspaceId) => {
      started.push({ repoPath, cwd, workspaceId });
      return id;
    },
  });
}

function workspace(attachments: Attachment[]): Workspace {
  return makeWorkspace("ws-1", { title: "a workspace", attachments });
}

function branch(
  name: string,
  overrides: Partial<LocalBranchInfo> = {},
): LocalBranchInfo {
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
    ...overrides,
  };
}

function seedActivity(branches: LocalBranchInfo[]): void {
  useSpurStore.setState({
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
  started.length = 0;
  useSpurStore.setState({
    localActivity: [],
    repoPath: null,
    reviewRef: null,
    reviewTier: null,
    activeReviewKey: null,
    contentFocus: "code",
  });
  vi.clearAllMocks();
});

describe("where a workspace's terminal starts", () => {
  /**
   * The bug this pins: the cwd used to come from whatever review the store was
   * last pointed at, so "Start a terminal" on a workspace with no repo of its
   * own opened a shell inside the *previous* workspace's checkout.
   */
  it("never inherits the previous workspace's checkout", async () => {
    stubStartTerminal();
    // The screen is still showing another workspace's review.
    useSpurStore.setState({ repoPath: OTHER, reviewRef: "main" });

    await openTerminalTab(workspace([]));

    expect(started).toEqual([{ repoPath: "", cwd: "", workspaceId: "ws-1" }]);
  });

  /**
   * An empty cwd is the frontend saying "no directory of its own"; the backend
   * turns that into home.
   */
  it("names the workspace so the tab and the session land together", async () => {
    stubStartTerminal();
    seedActivity([branch("feature", { isCurrent: true })]);

    await openTerminalTab(workspace([attachment(REPO, "feature")]));

    expect(started[0].workspaceId).toBe("ws-1");
  });

  it("starts in the tab's own worktree when it has one", async () => {
    stubStartTerminal();
    seedActivity([branch("feature", { worktreePath: "/wt/feature" })]);

    await openTerminalTab(workspace([attachment(REPO, "feature")]));

    expect(started[0]).toMatchObject({
      repoPath: REPO,
      cwd: "/wt/feature",
    });
  });

  it("starts at the repo root when the tab is what's checked out there", async () => {
    stubStartTerminal();
    seedActivity([branch("main", { isCurrent: true })]);

    await openTerminalTab(workspace([attachment(REPO, "main")]));

    expect(started[0].cwd).toBe(REPO);
  });

  /**
   * A tab with no checkout that isn't the open review can't be materialized —
   * the prompt hangs off the open review — so the repo root is the honest
   * answer rather than nothing at all.
   */
  it("falls back to the repo root for an unmaterialized branch elsewhere", async () => {
    stubStartTerminal();
    seedActivity([branch("dormant")]);
    useSpurStore.setState({ repoPath: OTHER, reviewRef: "main" });

    await openTerminalTab(workspace([attachment(REPO, "dormant")]));

    expect(started[0].cwd).toBe(REPO);
  });

  /**
   * A tab with no ref names a directory rather than a comparison, and that
   * directory is exactly where a shell in this workspace belongs — it is what
   * the router made the workspace from.
   */
  it("starts in a ref-less tab's own directory", async () => {
    stubStartTerminal();
    useSpurStore.setState({ repoPath: OTHER, reviewRef: "main" });

    await openTerminalTab(workspace([attachment("/tmp/scratch")]));

    expect(started[0]).toEqual({
      repoPath: "/tmp/scratch",
      cwd: "/tmp/scratch",
      workspaceId: "ws-1",
    });
  });

  /**
   * With several repo tabs open, a shell follows the one on screen — the
   * workspace's first tab is not where you are looking.
   */
  it("follows the repo tab that is on screen", async () => {
    stubStartTerminal();
    seedActivity([branch("feature", { isCurrent: true })]);
    useSpurStore.setState({
      activeReviewKey: { repoPath: REPO, ref: "feature" },
    });

    await openTerminalTab(
      workspace([attachment(OTHER, "main"), attachment(REPO, "feature")]),
    );

    expect(started[0]).toMatchObject({ repoPath: REPO, cwd: REPO });
  });

  /** Nothing on screen from this workspace: its first tab is the fallback. */
  it("falls back to the first repo tab", async () => {
    stubStartTerminal();
    seedActivity([branch("feature", { isCurrent: true })]);

    await openTerminalTab(
      workspace([attachment(REPO, "feature"), attachment(OTHER, "main")]),
    );

    expect(started[0]).toMatchObject({ repoPath: REPO, cwd: REPO });
  });

  /**
   * ⌘T with nothing focused still starts a shell. Naming no directory is what
   * hands the placement to the router — the backend starts in home and routes
   * by cwd, exactly as it would for a shell started outside the app — rather
   * than reaching for whichever review the store was last pointed at.
   */
  it("names no directory when no workspace is focused", async () => {
    stubStartTerminal();
    useSpurStore.setState({ repoPath: REPO, reviewRef: null });

    await openTerminalTab();

    expect(started[0]).toEqual({
      repoPath: "",
      cwd: "",
      workspaceId: undefined,
    });
  });
});

/**
 * The bug this pins: on both surfaces where the terminal is not already on
 * screen, starting one used to look like a dead button — the shell started, out
 * of sight, and nothing about the stage changed. A phone shows one half at a
 * time, so a new workspace's "Start a terminal" left you on the empty code
 * half; a code-focused desktop stage left the panel collapsed to its rail.
 */
describe("what starting a terminal puts on screen", () => {
  it("gives the terminal half of a code-focused stage back", async () => {
    stubStartTerminal();
    useSpurStore.setState({ contentFocus: "code" });

    await openTerminalTab(workspace([]));

    // Beside the code rather than instead of it. Phone width needs no branch
    // here: `codePushed` reads "split" as the code screen popped — the
    // terminal, which is where a new shell belongs — and writing "terminal"
    // instead would edit the layout the desktop chose.
    expect(useSpurStore.getState().contentFocus).toBe("split");
  });

  it("leaves a stage that already shows the terminal alone", async () => {
    stubStartTerminal();
    useSpurStore.setState({ contentFocus: "terminal" });

    await openTerminalTab(workspace([]));

    // ⌘T from inside a maximized shell must not rearrange the stage.
    expect(useSpurStore.getState().contentFocus).toBe("terminal");
  });

  it("stays put when nothing started", async () => {
    stubStartTerminal(null);
    useSpurStore.setState({ contentFocus: "code" });

    await openTerminalTab(workspace([]));

    expect(useSpurStore.getState().contentFocus).toBe("code");
  });

  /**
   * The repo picker starts a shell as a courtesy after "open this repo". Taking
   * the screen for it would answer a different question than the one asked —
   * and at phone width it would replace the half the pick was made in.
   */
  it("stays put for a caller whose gesture was not about the terminal", async () => {
    stubStartTerminal();
    useSpurStore.setState({ contentFocus: "code" });

    await openTerminalTab(workspace([]), null, { reveal: false });

    expect(useSpurStore.getState().contentFocus).toBe("code");
    expect(started).toHaveLength(1);
  });
});
