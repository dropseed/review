import { vi, describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { WorkItem } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({
    terminalPeek: vi.fn().mockResolvedValue(""),
    listWorkItems: vi.fn().mockResolvedValue([]),
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
import { phaseTextClass } from "./terminal-status-format";
import { useReviewStore } from "../../stores";
import { makeTab } from "../Terminal/pane-tree";
import { terminalStatus } from "../../test/fixtures";

const REPO = "/repo";

function item(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: `work ${id}`,
    refs: [{ repoPath: REPO, ref: "feature" }],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * A terminal with a phase, optionally attached to a work item — one session in
 * a tab of its own, which is what a rebuilt tab looks like (id = session id).
 */
function session(id: string, phase: "idle" | "working", itemId?: string) {
  const status = terminalStatus(phase, { id });
  const state = useReviewStore.getState();
  useReviewStore.setState({
    terminalSessions: {
      ...state.terminalSessions,
      [id]: {
        id,
        repoPath: REPO,
        cwd: REPO,
        title: `sh ${id}`,
        cols: 80,
        rows: 24,
        status,
      },
    },
    terminalStatuses: { ...state.terminalStatuses, [id]: status },
    terminalTabs: [...state.terminalTabs, makeTab(id, id)],
    terminalAttachments: itemId
      ? { ...state.terminalAttachments, [id]: `item:${itemId}` }
      : state.terminalAttachments,
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
  useReviewStore.setState({
    workItems: [],
    localActivity: [],
    terminalSessions: {},
    terminalStatuses: {},
    terminalTabs: [],
    terminalAttachments: {},
    terminalExited: {},
  });
  vi.clearAllMocks();
});

describe("the collapsed sidebar rail", () => {
  it("carries the work items as their position numbers", () => {
    useReviewStore.setState({ workItems: [item("a"), item("b"), item("c")] });
    const { container } = renderRail();
    expect(numbers(container)).toEqual(["1", "2", "3"]);
  });

  it("colors a number by the loudest phase among its own terminals", () => {
    useReviewStore.setState({ workItems: [item("a"), item("b")] });
    session("s1", "idle", "a");
    session("s2", "working", "a");

    const { container } = renderRail();
    const [first, second] = [...container.querySelectorAll("button")].filter(
      (b) => /^\d+$/.test(b.textContent ?? ""),
    );

    // `working` outranks `idle`, and the item with no terminals stays neutral.
    expect(first.className).toContain(phaseTextClass("working"));
    expect(second.className).toContain("text-fg-muted");
  });

  it("opens the item the number stands for", () => {
    useReviewStore.setState({
      workItems: [item("a")],
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

  it("keeps a terminal no item claimed reachable, as a glyph", () => {
    useReviewStore.setState({ workItems: [item("a")] });
    session("attached", "idle", "a");
    session("loose", "working");

    const { container } = renderRail();
    // The attached one is already reachable through its item's number, so the
    // rail must not list it twice.
    const glyphs = [...container.querySelectorAll("button")].filter(
      (b) => b.getAttribute("aria-label")?.startsWith("sh ") ?? false,
    );
    expect(glyphs.map((b) => b.getAttribute("aria-label"))).toEqual([
      "sh loose",
    ]);

    fireEvent.click(glyphs[0]);
    expect(jumpToTab).toHaveBeenCalledWith("loose");
  });
});
