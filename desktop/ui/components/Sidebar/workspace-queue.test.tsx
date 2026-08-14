import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Workspace } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({
    listWorkspaces: vi.fn().mockResolvedValue([]),
    terminalPeek: vi.fn().mockResolvedValue(""),
  }),
}));

const { activateReviewKey, navigate } = vi.hoisted(() => ({
  activateReviewKey: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("../../commands/host", () => ({
  getCommandUi: () => ({ activateReviewKey, navigate }),
}));

import { WorkspaceQueue } from "./WorkspaceQueue";
import { useReviewStore } from "../../stores";
import { makeTab } from "../Terminal/pane-tree";
import {
  attachment,
  terminalStatus,
  workspace as makeWorkspace,
} from "../../test/fixtures";

const REPO = "/repo";

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return makeWorkspace(id, {
    title: `work ${id}`,
    attachments: [attachment(REPO, "feature")],
    ...overrides,
  });
}

/** A terminal in `workspaceId`, as one session in a tab of its own. */
function session(
  id: string,
  phase: "idle" | "working" | "waiting_for_input",
  workspaceId: string,
  attentionMessage: string | null = null,
): void {
  const status = { ...terminalStatus(phase, { id }), attentionMessage };
  const state = useReviewStore.getState();
  useReviewStore.setState({
    terminalSessions: {
      ...state.terminalSessions,
      [id]: {
        id,
        repoPath: REPO,
        workspaceId,
        cwd: REPO,
        title: `sh ${id}`,
        cols: 80,
        rows: 24,
        status,
      },
    },
    terminalStatuses: { ...state.terminalStatuses, [id]: status },
    terminalTabs: [...state.terminalTabs, makeTab(id, id)],
  });
}

function entries(): HTMLElement[] {
  return screen.getAllByRole("option");
}

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    workspaces: [],
    focusedWorkspaceId: null,
    localActivity: [],
    terminalSessions: {},
    terminalStatuses: {},
    terminalTabs: [],
    terminalExited: {},
  });
  vi.clearAllMocks();
});

describe("what every entry shows", () => {
  /**
   * Focused or not, live or not: the card is the only surface that reports a
   * workspace's repos and status, so a dormant entry shows its chips too — a
   * queue of bare names would send the user into each one to find out.
   */
  it("gives dormant and live workspaces alike their repo chips", () => {
    useReviewStore.setState({
      workspaces: [workspace("live"), workspace("dormant")],
    });
    session("s1", "working", "live");
    render(<WorkspaceQueue />);

    const [live, dormant] = entries();
    expect(live.textContent).toContain("repo · feature");
    expect(dormant.textContent).toContain("repo · feature");
  });

  it("puts the waiting snippet on the card, and only while waiting", () => {
    useReviewStore.setState({
      workspaces: [workspace("blocked"), workspace("busy")],
    });
    session("s1", "waiting_for_input", "blocked", "Continue? (y/n)");
    session("s2", "working", "busy");
    render(<WorkspaceQueue />);

    const [blocked, busy] = entries();
    expect(blocked.textContent).toContain("Continue? (y/n)");
    expect(busy.textContent).not.toContain("Continue?");
  });
});

describe("what a card says about itself", () => {
  /**
   * A router-made workspace is an ordinary one on screen: `autoCreated` drives
   * backend cleanup and nothing else, so nothing here may read as a second
   * class of card.
   */
  it("says nothing about a workspace being router-made", () => {
    useReviewStore.setState({
      workspaces: [workspace("ghost", { autoCreated: true })],
    });
    render(<WorkspaceQueue />);

    const card = entries()[0];
    expect(card.textContent).toContain("work ghost");
    expect(card.className).not.toContain("dashed");
  });

  /** The derived title is the backend's; the card renders it, never re-rolls it. */
  it("renders the derived title of an untitled workspace", () => {
    useReviewStore.setState({
      workspaces: [
        makeWorkspace("u", { attachments: [attachment(REPO, "feature")] }),
      ],
    });
    render(<WorkspaceQueue />);
    expect(entries()[0].textContent).toBe("repo · feature");
  });
});

describe("keyboard navigation", () => {
  it("walks the queue with the arrows and opens with Enter", () => {
    useReviewStore.setState({
      workspaces: [workspace("a"), workspace("b")],
      localActivity: [
        {
          repoPath: REPO,
          repoName: "repo",
          defaultBranch: "main",
          branches: [
            {
              name: "feature",
              isCurrent: false,
              commitsAhead: 1,
              unpushedCommits: 0,
              hasWorkingTreeChanges: false,
              lastCommitDate: new Date().toISOString(),
              lastCommitMessage: "x",
              lastCommitByUser: true,
              worktreePath: null,
              lastModifiedAt: null,
              workingTreeStats: null,
            },
          ],
          recentRemoteBranches: [],
        },
      ],
    });
    render(<WorkspaceQueue />);

    const [first, second] = entries();
    // Nothing focused yet: ArrowDown enters at the top so one press moves.
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Enter" });
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");
    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
  });
});
