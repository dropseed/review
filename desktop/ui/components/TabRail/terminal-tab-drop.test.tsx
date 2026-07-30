import { vi, describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { GlobalReviewSummary } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({ terminalPeek: vi.fn().mockResolvedValue("") }),
}));

import { TabRailItem } from "./TabRailItem";
import { TERMINAL_TAB_MIME } from "./useTerminalTabDrop";
import { useReviewStore } from "../../stores";
import { makeTab } from "../Terminal/pane-tree";

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

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    terminalTabsByReviewKey: {},
    activeTabIdByReviewKey: {},
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
