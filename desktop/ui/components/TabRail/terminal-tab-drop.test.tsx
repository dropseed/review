import { vi, describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { GlobalReviewSummary } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({ terminalPeek: vi.fn().mockResolvedValue("") }),
}));

import { TabRailItem } from "./TabRailItem";
import { TerminalRowList } from "./TerminalRowList";
import { TERMINAL_TAB_MIME } from "./useTerminalTabDrop";
import { useReviewStore } from "../../stores";
import {
  draggedTerminal,
  setDraggedTerminal,
  TERMINAL_SESSION_MIME,
} from "../Terminal/pane-drag";
import { makeTab } from "../Terminal/pane-tree";
import { terminalStatus } from "../../test/fixtures";

const REPO = "/repo";

function review(): GlobalReviewSummary {
  return {
    repoPath: REPO,
    repoName: "repo",
    ref: "feature",
    tier: "materialized",
    totalHunks: 1,
    trustedHunks: 0,
    approvedHunks: 0,
    reviewedHunks: 0,
    rejectedHunks: 0,
    savedForLaterHunks: 0,
    state: null,
    updatedAt: new Date().toISOString(),
    worktreePath: "/wt/feature",
  };
}

/** Only `types` is readable during dragover, which is what the row reads. */
function dataTransfer(type: string, value: string) {
  return {
    types: [type],
    getData: (t: string) => (t === type ? value : ""),
    dropEffect: "",
  };
}

function renderRow(): HTMLElement {
  const { container } = render(
    <TabRailItem
      review={review()}
      repoName="repo"
      defaultBranch="main"
      onActivate={() => {}}
      onDelete={() => {}}
    />,
  );
  const row = container.querySelector<HTMLElement>('[role="button"]');
  if (!row) throw new Error("no row rendered");
  return row;
}

/** One session of `REPO`, live enough for a sidebar row to be drawn for it. */
function seedSession(id: string, homeKey: string): void {
  const status = terminalStatus("idle", { id });
  useReviewStore.setState({
    terminalSessions: {
      [id]: {
        id,
        repoPath: REPO,
        cwd: "/wt/feature",
        title: "sh",
        cols: 80,
        rows: 24,
        status,
      },
    },
    terminalStatuses: { [id]: status },
    terminalHomes: { [id]: homeKey },
  });
}

afterEach(() => {
  cleanup();
  setDraggedTerminal(null);
  useReviewStore.setState({
    terminalTabsByReviewKey: {},
    activeTabIdByReviewKey: {},
    terminalIdsByReviewKey: {},
    terminalSessions: {},
    terminalStatuses: {},
    terminalHomes: {},
  });
  vi.clearAllMocks();
});

describe("dropping a terminal tab on a sidebar row", () => {
  it("re-homes the tab onto the row it was dropped on", () => {
    useReviewStore.setState({
      terminalTabsByReviewKey: { "/repo:main": [makeTab("tabA", "a")] },
    });
    const row = renderRow();

    fireEvent.drop(row, {
      dataTransfer: dataTransfer(TERMINAL_TAB_MIME, "tabA"),
    });

    const state = useReviewStore.getState();
    expect(state.terminalHomes.a).toBe("/repo:feature");
    expect(
      state.terminalTabsByReviewKey["/repo:feature"].map((t) => t.id),
    ).toEqual(["tabA"]);
  });

  it("re-homes a session dragged by its own sidebar row", () => {
    // No tab in this window at all — the case the tab-level drop can't serve,
    // and the reason dragging between repos needs its own payload.
    seedSession("a", `${REPO}:main`);
    const row = renderRow();

    fireEvent.drop(row, {
      dataTransfer: dataTransfer(TERMINAL_SESSION_MIME, "a"),
    });

    const state = useReviewStore.getState();
    expect(state.terminalHomes.a).toBe("/repo:feature");
    expect(state.terminalIdsByReviewKey["/repo:feature"]).toEqual(["a"]);
  });

  it("ignores a drag that isn't a terminal tab", () => {
    useReviewStore.setState({
      terminalTabsByReviewKey: { "/repo:main": [makeTab("tabA", "a")] },
    });
    const row = renderRow();

    // A file drag carries text/plain too — claiming it would swallow drops
    // meant for whatever else on the page handles them.
    fireEvent.dragOver(row, {
      dataTransfer: dataTransfer("text/plain", "tabA"),
    });
    fireEvent.drop(row, { dataTransfer: dataTransfer("text/plain", "tabA") });

    expect(useReviewStore.getState().terminalHomes).toEqual({});
    expect(
      useReviewStore.getState().terminalTabsByReviewKey["/repo:main"],
    ).toHaveLength(1);
  });
});

describe("dragging a sidebar terminal row", () => {
  it("carries the session on both the drag payload and the module latch", () => {
    seedSession("a", `${REPO}:feature`);
    const { container } = render(
      <TerminalRowList reviewKey={`${REPO}:feature`} />,
    );
    const row = container.querySelector<HTMLElement>('[role="button"]');
    if (!row) throw new Error("no terminal row rendered");

    const setData = vi.fn();
    fireEvent.dragStart(row, {
      dataTransfer: { setData, effectAllowed: "" },
    });

    // The payload serves the web path, the latch the Tauri one — where the drop
    // arrives on the window, after our own dragend, with no readable transfer.
    expect(setData).toHaveBeenCalledWith(TERMINAL_SESSION_MIME, "a");
    expect(draggedTerminal()).toBe("a");

    fireEvent.dragEnd(row);
    expect(draggedTerminal()).toBeNull();
  });
});
