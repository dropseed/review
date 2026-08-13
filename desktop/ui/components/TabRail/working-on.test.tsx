import { vi, describe, it, expect, afterEach } from "vitest";
import {
  render,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import type { WorkItem } from "../../types";

// Hoisted, because the store builds its client the moment the module under
// test is imported — which is before any plain `const` here has run.
const { bindWorkItem, addWorkItem, moveWorkItem, unbindWorkItem } = vi.hoisted(
  () => ({
    bindWorkItem: vi.fn().mockResolvedValue([]),
    addWorkItem: vi.fn().mockResolvedValue([]),
    moveWorkItem: vi.fn().mockResolvedValue([]),
    unbindWorkItem: vi.fn().mockResolvedValue([]),
  }),
);

const { jumpToTab, jumpToTerminal } = vi.hoisted(() => ({
  jumpToTab: vi.fn(),
  jumpToTerminal: vi.fn(),
}));
vi.mock("../Terminal/jump", () => ({
  jumpToTab,
  jumpToTerminal,
  focusNextNeedsYou: vi.fn(),
}));

const activateReviewKey = vi.fn();
vi.mock("../../commands/host", () => ({
  getCommandUi: () => ({ activateReviewKey }),
}));

vi.mock("../../api", () => ({
  getApiClient: () => ({
    terminalPeek: vi.fn().mockResolvedValue(""),
    listWorkItems: vi.fn().mockResolvedValue([]),
    bindWorkItem,
    addWorkItem,
    moveWorkItem,
    unbindWorkItem,
  }),
}));

import { WorkingOnSection } from "./WorkingOnSection";
import { useReviewStore } from "../../stores";
import { itemHome } from "../../stores/slices/terminalSlice";
import {
  setDraggedWorkRef,
  setWorkDropTarget,
  WORK_REF_MIME,
} from "./work-drag";
import { setDraggedPane, TERMINAL_PANE_MIME } from "../Terminal/pane-drag";
import { leaf, makeTab, splitLeaf } from "../Terminal/pane-tree";
import type { TerminalSessionInfo, TerminalStatus } from "../../types";

const REPO = "/repo";

/** Let a drop's own promise chain run to the end inside the caller's `act`. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "one",
    title: "",
    refs: [{ repoPath: REPO, ref: "feature" }],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function seed(items: WorkItem[]): void {
  useReviewStore.setState({
    workItems: items,
    localActivity: [
      {
        repoPath: REPO,
        repoName: "repo",
        defaultBranch: "main",
        branches: [
          {
            name: "other",
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
}

/** One split tab, claimed by `itemId` — a card's terminal child row. */
function seedSplitTab(itemId: string): void {
  const session = (id: string, title: string): TerminalSessionInfo =>
    ({
      id,
      repoPath: REPO,
      cwd: REPO,
      title,
      cols: 80,
      rows: 24,
    }) as TerminalSessionInfo;
  useReviewStore.setState({
    terminalSessions: { a: session("a", "claude"), b: session("b", "zsh") },
    terminalStatuses: {
      a: { id: "a", phase: "needs_attention" } as TerminalStatus,
      b: { id: "b", phase: "idle" } as TerminalStatus,
    },
    terminalExited: {},
    terminalTabs: [
      { ...makeTab("tabA", "a"), root: splitLeaf(leaf("a"), "a", "b", "row") },
    ],
    terminalAttachments: { tabA: itemHome(itemId) },
  });
}

afterEach(() => {
  cleanup();
  setDraggedWorkRef(null);
  setDraggedPane(null);
  setWorkDropTarget(null);
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

describe("WorkingOnSection", () => {
  it("names a bound card after its branch and says what it is doing", () => {
    seed([item()]);
    const { getByText } = render(<WorkingOnSection />);
    getByText("feature");
    getByText(/uncommitted changes/);
  });

  it("keeps a note's own title", () => {
    seed([item({ id: "two", title: "Reply to billing email", refs: [] })]);
    const { getByText } = render(<WorkingOnSection />);
    getByText("Reply to billing email");
  });

  /**
   * The section container, which owns the drop. The target itself is published
   * before the drop, the way `dragover` does in the app — jsdom's rects are
   * all zero, so the geometry that picks a target from the cursor is exercised
   * in `work-drag.test.ts` against explicit rects instead.
   */
  function section(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>("[data-work-section]");
    if (!found) throw new Error("no section rendered");
    return found;
  }

  it("binds a ref dropped on a card", async () => {
    seed([item()]);
    const { container } = render(<WorkingOnSection />);

    // The latches are what the drop reads — under Tauri `dataTransfer` is
    // unreadable by the time the drop arrives.
    setDraggedWorkRef({
      ref: { repoPath: REPO, ref: "other" },
      fromItemId: null,
    });
    setWorkDropTarget({ kind: "card", itemId: "one" });
    // The optimistic write lands after the drop handler's first await, so the
    // whole gesture has to sit inside act.
    await act(async () => {
      fireEvent.drop(section(container), {
        dataTransfer: { types: [WORK_REF_MIME], getData: () => "" },
      });
      await settle();
    });

    await waitFor(() =>
      expect(bindWorkItem).toHaveBeenCalledWith("one", REPO, "other"),
    );
  });

  it("makes a new item from a ref dropped between cards", async () => {
    seed([item()]);
    const { container } = render(<WorkingOnSection />);

    setDraggedWorkRef({
      ref: { repoPath: REPO, ref: "other" },
      fromItemId: null,
    });
    setWorkDropTarget({ kind: "gap", index: 0 });
    await act(async () => {
      fireEvent.drop(section(container), {
        dataTransfer: { types: [WORK_REF_MIME], getData: () => "" },
      });
      await settle();
    });

    await waitFor(() =>
      expect(addWorkItem).toHaveBeenCalledWith("", [
        { repoPath: REPO, ref: "other" },
      ]),
    );
  });

  it("attaches a terminal panel pane dropped on a card", async () => {
    seed([item()]);
    const { container } = render(<WorkingOnSection />);

    // A pane is picked up in the terminal panel and latched by *its* module —
    // the section reads that latch, so panel and sidebar are one drag.
    useReviewStore.setState({ terminalTabs: [makeTab("tabA", "a")] });
    setDraggedPane("a");
    setWorkDropTarget({ kind: "card", itemId: "one" });
    await act(async () => {
      fireEvent.drop(section(container), {
        dataTransfer: { types: [TERMINAL_PANE_MIME], getData: () => "" },
      });
      await settle();
    });

    // The pane's whole tab is what gets claimed.
    await waitFor(() =>
      expect(useReviewStore.getState().terminalAttachments["tabA"]).toBe(
        itemHome("one"),
      ),
    );
  });
});

describe("a card's terminal rows", () => {
  it("draws one row per tab, with a glyph per pane", () => {
    seed([item()]);
    seedSplitTab("one");
    const { getByRole, getAllByRole } = render(<WorkingOnSection />);

    // One row for the tab...
    const rows = getAllByRole("button", { name: "claude" });
    expect(rows).toHaveLength(1);
    // ...and a glyph naming each shell inside it.
    getByRole("button", { name: "claude — Needs attention" });
    getByRole("button", { name: "zsh — Idle" });
  });

  it("opens the pane whose glyph was clicked, not the tab", () => {
    seed([item()]);
    seedSplitTab("one");
    const { getByRole } = render(<WorkingOnSection />);

    fireEvent.click(getByRole("button", { name: "zsh — Idle" }));

    expect(jumpToTerminal).toHaveBeenCalledWith("b");
    expect(jumpToTab).not.toHaveBeenCalled();
  });
});

describe("a ref chip", () => {
  const twoRefs = () =>
    item({
      refs: [
        { repoPath: REPO, ref: "other" },
        { repoPath: REPO, ref: "feature" },
      ],
    });

  function chip(container: HTMLElement, ref: string): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      `[title="${REPO} — ${ref}"]`,
    );
    if (!found) throw new Error(`no chip for ${ref}`);
    return found;
  }

  it("opens its own ref, not the card's first", () => {
    seed([twoRefs()]);
    const { container } = render(<WorkingOnSection />);

    fireEvent.click(chip(container, "feature"));

    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
    expect(activateReviewKey).not.toHaveBeenCalledWith(REPO, "other");
  });

  it("changes nothing when dragged to nowhere", async () => {
    seed([twoRefs()]);
    const { container } = render(<WorkingOnSection />);
    const target = chip(container, "feature");

    fireEvent.dragStart(target, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    // Released over nothing: `dragend` fires with no drop in between, which
    // must not be read as "unbind it from where it came from".
    fireEvent.dragEnd(target);
    await act(settle);

    expect(unbindWorkItem).not.toHaveBeenCalled();
    expect(bindWorkItem).not.toHaveBeenCalled();
    expect(addWorkItem).not.toHaveBeenCalled();
  });
});
