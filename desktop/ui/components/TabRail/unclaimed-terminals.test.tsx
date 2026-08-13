import { vi, describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../../api", () => ({
  getApiClient: () => ({
    terminalPeek: vi.fn().mockResolvedValue(""),
    listWorkItems: vi.fn().mockResolvedValue([]),
  }),
}));

const { jumpToTab, jumpToTerminal } = vi.hoisted(() => ({
  jumpToTab: vi.fn(),
  jumpToTerminal: vi.fn(),
}));
vi.mock("../Terminal/jump", () => ({ jumpToTab, jumpToTerminal }));

import { UnclaimedTerminals } from "./UnclaimedTerminals";
import { useReviewStore } from "../../stores";
import { itemHome } from "../../stores/slices/terminalSlice";
import { leaf, makeTab, splitLeaf } from "../Terminal/pane-tree";
import type { TerminalSessionInfo, TerminalStatus } from "../../types";

const REPO = "/repo";
const SESSION = "s1";

/** One live terminal — a session in a tab of its own — attached to nothing. */
function seed(): void {
  useReviewStore.setState({
    workItems: [],
    localActivity: [
      {
        repoPath: REPO,
        repoName: "repo",
        defaultBranch: "main",
        branches: [],
        recentRemoteBranches: [],
      },
    ],
    terminalSessions: {
      [SESSION]: {
        id: SESSION,
        repoPath: REPO,
        cwd: REPO,
        title: "claude",
        cols: 80,
        rows: 24,
      } as TerminalSessionInfo,
    },
    terminalTabs: [makeTab(SESSION, SESSION)],
    terminalAttachments: {},
    terminalExited: {},
    terminalStatuses: {
      [SESSION]: {
        id: SESSION,
        phase: "working",
        runningCommand: "claude",
      } as TerminalStatus,
    },
  });
}

/** Split the seeded tab, giving it a second pane sitting at its prompt. */
function splitSeeded(): void {
  const state = useReviewStore.getState();
  useReviewStore.setState({
    terminalSessions: {
      ...state.terminalSessions,
      s2: {
        id: "s2",
        repoPath: REPO,
        cwd: REPO,
        title: "zsh",
        cols: 80,
        rows: 24,
      } as TerminalSessionInfo,
    },
    terminalStatuses: {
      ...state.terminalStatuses,
      s2: { id: "s2", phase: "idle" } as TerminalStatus,
    },
    terminalTabs: [
      {
        ...makeTab(SESSION, SESSION),
        root: splitLeaf(leaf(SESSION), SESSION, "s2", "row"),
      },
    ],
  });
}

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    workItems: [],
    localActivity: [],
    terminalSessions: {},
    terminalStatuses: {},
    terminalTabs: [],
    terminalAttachments: {},
  });
  vi.clearAllMocks();
});

describe("the unclaimed-terminals band", () => {
  it("lists a terminal no work item holds, and jumps to it on click", () => {
    seed();
    const { getByRole } = render(<UnclaimedTerminals />);
    fireEvent.click(getByRole("button", { name: /claude/ }));
    expect(jumpToTab).toHaveBeenCalledWith(SESSION);
  });

  it("renders nothing when every terminal is claimed", () => {
    seed();
    useReviewStore.setState({
      workItems: [{ id: "w1", title: "work", refs: [], createdAt: "" }],
      terminalAttachments: { [SESSION]: itemHome("w1") },
    });
    const { container } = render(<UnclaimedTerminals />);
    expect(container.firstChild).toBeNull();
  });

  it("shows one glyph per pane once the tab is split, each its own phase", () => {
    seed();
    splitSeeded();
    const { getByRole } = render(<UnclaimedTerminals />);

    // Named by pane, so a row for two shells says which of them is which.
    getByRole("button", { name: "claude — Working" });
    getByRole("button", { name: "zsh — Idle" });
  });

  it("lands on the pane whose glyph was clicked", () => {
    seed();
    splitSeeded();
    const { getByRole } = render(<UnclaimedTerminals />);

    fireEvent.click(getByRole("button", { name: "zsh — Idle" }));

    // The pane, not the tab: the row's own click is what opens it at whichever
    // pane it was left on.
    expect(jumpToTerminal).toHaveBeenCalledWith("s2");
    expect(jumpToTab).not.toHaveBeenCalled();
  });

  it("gives an unsplit tab the one marker every other row carries", () => {
    seed();
    const { queryByRole } = render(<UnclaimedTerminals />);
    expect(queryByRole("button", { name: /Working$/ })).toBeNull();
  });

  it("makes a work item of the terminal from the row's own button", async () => {
    seed();
    const addWorkItem = vi.fn().mockResolvedValue(null);
    useReviewStore.setState({ addWorkItem });
    const { getByRole } = render(<UnclaimedTerminals />);
    fireEvent.click(getByRole("button", { name: "Add to Working on" }));
    expect(addWorkItem).toHaveBeenCalledWith("claude", []);
  });
});
