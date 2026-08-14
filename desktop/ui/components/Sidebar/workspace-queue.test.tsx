import { vi, describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import type { Workspace } from "../../types";
import { IS_MAC } from "../../commands/shortcuts";

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
import { makeTab, splitLeaf } from "../Terminal/pane-tree";
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

/** The row a card draws for one terminal tab, found by the title it shows. */
function terminalRow(title: string): HTMLElement {
  return screen.getByTitle(title);
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
    activeTabId: null,
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

describe("the terminals on a card", () => {
  it("gives every terminal of a workspace its own line", () => {
    useReviewStore.setState({
      workspaces: [workspace("w"), workspace("other")],
    });
    session("s1", "working", "w");
    session("s2", "waiting_for_input", "w");
    session("s3", "idle", "other");
    render(<WorkspaceQueue />);

    const [own, other] = entries();
    expect(own.textContent).toContain("sh s1");
    expect(own.textContent).toContain("sh s2");
    // A tab belongs to exactly one workspace, so no card lists another's.
    expect(own.textContent).not.toContain("sh s3");
    expect(other.textContent).toContain("sh s3");
  });

  /** No heading, no placeholder: a dormant card is what it was before. */
  it("draws nothing for a workspace running nothing", () => {
    useReviewStore.setState({
      workspaces: [workspace("live"), workspace("dormant")],
    });
    session("s1", "working", "live");
    render(<WorkspaceQueue />);

    const [live, dormant] = entries();
    expect(within(live).getByTitle("sh s1")).toBeTruthy();
    expect(within(dormant).queryByTitle(/^sh /)).toBeNull();
  });

  /** The strip's vocabulary for a split tab — the leaf count, not a row each. */
  it("says how many panes a split tab holds", () => {
    useReviewStore.setState({ workspaces: [workspace("w")] });
    session("s1", "working", "w");
    session("s2", "idle", "w");
    const state = useReviewStore.getState();
    // s2's pane joins s1's tab rather than standing as one of its own.
    useReviewStore.setState({
      terminalTabs: [
        {
          ...state.terminalTabs[0]!,
          root: splitLeaf(state.terminalTabs[0]!.root, "s1", "s2", "row"),
        },
      ],
    });
    render(<WorkspaceQueue />);

    expect(terminalRow("sh s1").textContent).toBe("sh s12");
  });

  /**
   * The membership rule: a tab the status stream hasn't reported on has no
   * phase and no title, so it is not yet something the card can list.
   */
  it("waits for the status stream before listing a tab", () => {
    useReviewStore.setState({ workspaces: [workspace("w")] });
    session("s1", "working", "w");
    useReviewStore.setState({ terminalStatuses: {} });
    render(<WorkspaceQueue />);

    expect(entries()[0].textContent).not.toContain("sh s1");
  });

  /**
   * Clicking a terminal opens *that* terminal. The card's own click opens the
   * workspace on whichever tab it was last showing, so the row has to stop the
   * click reaching it — otherwise pointing at one terminal would land on
   * another.
   */
  it("opens the terminal the row names, not the workspace's last one", () => {
    useReviewStore.setState({ workspaces: [workspace("w")] });
    session("s1", "working", "w");
    session("s2", "working", "w");
    useReviewStore.getState().setActiveTab("s2");
    render(<WorkspaceQueue />);

    fireEvent.click(terminalRow("sh s1"));
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("w");
    expect(useReviewStore.getState().activeTabId).toBe("s1");
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

describe("the ⌘ digits", () => {
  /** Ten cards: the tenth has no shortcut, so it has no digit to reveal. */
  function tenWorkspaces(): void {
    useReviewStore.setState({
      workspaces: Array.from({ length: 10 }, (_, i) => workspace(`w${i}`)),
    });
  }

  /**
   * Press and release the `mod` key for whatever platform the test is running
   * on — ⌘ on macOS, Ctrl elsewhere, exactly as the shortcuts these badges
   * advertise are resolved. Spelling it `metaKey` here passed on a Mac and hid
   * that the badges were inverted everywhere else.
   */
  const modDown = (key = IS_MAC ? "Meta" : "Control") =>
    fireEvent.keyDown(window, {
      key,
      metaKey: IS_MAC,
      ctrlKey: !IS_MAC,
    });
  const modUp = () =>
    fireEvent.keyUp(window, {
      key: IS_MAC ? "Meta" : "Control",
      metaKey: false,
      ctrlKey: false,
    });

  function digits(): (string | null)[] {
    return entries().map(
      (entry) =>
        entry.querySelector("[data-shortcut-digit]")?.textContent ?? null,
    );
  }

  it("shows each card's number while ⌘ is held, and only the first nine", () => {
    tenWorkspaces();
    render(<WorkspaceQueue />);
    expect(digits().every((digit) => digit === null)).toBe(true);

    modDown();
    expect(digits()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      null,
    ]);
  });

  it("keeps them up for the rest of the chord", () => {
    tenWorkspaces();
    render(<WorkspaceQueue />);

    modDown();
    // mod then a digit: the shortcut is firing, and the numbers it is firing
    // against must not blink out from under it.
    modDown("3");
    expect(digits()[2]).toBe("3");

    modUp();
    expect(digits()[2]).toBeNull();
  });

  /**
   * ⌘Tab takes the window away mid-chord and the `keyup` is delivered to
   * whatever the user switched to, never here — so the badges would stay up
   * over a window nobody is holding a key against.
   */
  it("gives up on the key when the window does", () => {
    tenWorkspaces();
    render(<WorkspaceQueue />);

    modDown();
    fireEvent.blur(window);
    expect(digits()[0]).toBeNull();

    modDown();
    fireEvent(document, new Event("visibilitychange"));
    expect(digits()[0]).toBeNull();
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
              behindUpstream: 0,
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
