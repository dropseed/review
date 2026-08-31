import { vi, describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Workspace } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({
    listWorkspaces: vi.fn().mockResolvedValue([]),
  }),
}));

// Hoisted, because `vi.mock`'s factory runs above every plain `const` here.
const { jumpToTab, activateReviewKey } = vi.hoisted(() => ({
  jumpToTab: vi.fn(),
  activateReviewKey: vi.fn(),
}));

vi.mock("../Terminal/jump", () => ({ jumpToTab }));
vi.mock("../../commands/host", () => ({
  getCommandUi: () => ({ activateReviewKey }),
}));

import { SidebarRail } from "./SidebarRail";
import { TooltipProvider } from "../ui/tooltip";
import { useSpurStore } from "../../stores";
import { makeTab } from "../Terminal/pane-tree";
import { attachment, terminalStatus, workspace } from "../../test/fixtures";

const REPO = "/repo";

function item(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return workspace(id, {
    title: `work ${id}`,
    attachments: [attachment(REPO, "feature")],
    ...overrides,
  });
}

/**
 * A terminal with a phase, in a workspace — one session in a tab of its own,
 * which is what a rebuilt tab looks like (id = session id).
 */
function session(id: string, phase: "idle" | "working", workspaceId: string) {
  const status = terminalStatus(phase, { id });
  const state = useSpurStore.getState();
  useSpurStore.setState({
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

/** Every rail entry is a tooltip trigger, so the provider is not optional. */
function renderRail() {
  return render(
    <TooltipProvider>
      <SidebarRail onExpand={() => {}} />
    </TooltipProvider>,
  );
}

function numbers(container: HTMLElement): string[] {
  return [...container.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .filter((text) => /^\d+$/.test(text));
}

afterEach(() => {
  cleanup();
  useSpurStore.setState({
    workspaces: [],
    localActivity: [],
    terminalSessions: {},
    terminalStatuses: {},
    terminalTabs: [],
    terminalExited: {},
  });
  vi.clearAllMocks();
});

describe("the collapsed sidebar rail", () => {
  it("carries the workspaces as their position numbers", () => {
    useSpurStore.setState({ workspaces: [item("a"), item("b"), item("c")] });
    const { container } = renderRail();
    expect(numbers(container)).toEqual(["1", "2", "3"]);
  });

  /**
   * The rail's dot is the card's dot: it answers "does this want me", not
   * "what is that shell doing", so `working` collapses to running and a
   * workspace with no terminals at all reads as dormant.
   */
  it("marks a number with the state its own terminals put it in", () => {
    useSpurStore.setState({ workspaces: [item("a"), item("b")] });
    session("s1", "idle", "a");
    session("s2", "working", "a");

    const { container } = renderRail();
    const [first, second] = [...container.querySelectorAll("button")].filter(
      (b) => /^\d+$/.test(b.textContent ?? ""),
    );

    // `working` outranks `idle`; the workspace with no terminals is dormant.
    expect(first.querySelector("span")?.className).toContain(
      "bg-phase-working",
    );
    expect(second.querySelector("span")?.className).toContain("border");
  });

  it("opens the workspace the number stands for", () => {
    useSpurStore.setState({
      workspaces: [item("a")],
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
              hasWorkingTreeChanges: true,
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

    const { container } = renderRail();
    const one = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "1",
    );
    fireEvent.click(one!);

    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
  });
});
