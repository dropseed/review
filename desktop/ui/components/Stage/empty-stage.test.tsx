import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../api", () => ({
  getApiClient: () => ({
    listWorkspaces: vi.fn().mockResolvedValue([]),
    terminalPeek: vi.fn().mockResolvedValue(""),
  }),
}));

vi.mock("../../commands/host", () => ({
  getCommandUi: () => ({
    activateReviewKey: vi.fn(),
    openPath: vi.fn(),
    navigate: vi.fn(),
  }),
}));

import { EmptyStage } from "./EmptyStage";
import { useReviewStore } from "../../stores";
import { makeTab } from "../Terminal/pane-tree";
import { attachment, terminalSession, workspace } from "../../test/fixtures";

function focus(overrides = {}) {
  useReviewStore.setState({
    workspaces: [workspace("w", overrides)],
    focusedWorkspaceId: "w",
  });
}

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    workspaces: [],
    focusedWorkspaceId: null,
    activeReviewKey: null,
    terminalSessions: {},
    terminalTabs: [],
  });
  vi.clearAllMocks();
});

describe("a workspace with nothing in it", () => {
  it("offers both halves' verbs, where those halves will be", () => {
    focus();
    render(<EmptyStage />);

    expect(screen.getByText("Start a terminal")).toBeDefined();
    expect(screen.getByText("Open a repo")).toBeDefined();
    expect(screen.getByLabelText("Find a repo")).toBeDefined();
  });

  /**
   * The list is what the app already knows about, and a first launch knows
   * nothing — so the half whose whole job is "open a repo" has to carry the way
   * to one it has never seen.
   */
  it("offers a folder the app has never seen", () => {
    focus();
    render(<EmptyStage />);

    expect(screen.getByText("Open folder…")).toBeDefined();
  });

  /** No repo yet, so the shell's directory can only be named in the general. */
  it("says where a terminal would start", () => {
    focus();
    render(<EmptyStage />);

    expect(
      screen.getByText("Starts in this workspace's repo, or your home folder."),
    ).toBeDefined();
  });

  /**
   * The terminal dock draws the left half as soon as the workspace has one
   * thing in it, so offering to start a terminal here as well would be the
   * same verb twice on one screen.
   */
  it("drops the terminal half once the dock owns it", () => {
    focus({ attachments: [attachment("/repo", "main")] });
    render(<EmptyStage />);

    expect(screen.queryByText("Start a terminal")).toBeNull();
    expect(screen.getByLabelText("Find a repo")).toBeDefined();
  });

  it("drops it for a workspace whose terminals are already running", () => {
    focus();
    useReviewStore.setState({
      terminalSessions: { t1: terminalSession("t1", { workspaceId: "w" }) },
      terminalTabs: [makeTab("t1", "t1")],
    });
    render(<EmptyStage />);

    expect(screen.queryByText("Start a terminal")).toBeNull();
  });
});
