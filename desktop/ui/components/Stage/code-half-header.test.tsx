import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { detachWorkspace, attachWorkspace } = vi.hoisted(() => ({
  detachWorkspace: vi.fn().mockResolvedValue([]),
  attachWorkspace: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../api", () => ({
  getApiClient: () => ({
    listWorkspaces: vi.fn().mockResolvedValue([]),
    detachWorkspace,
    attachWorkspace,
  }),
}));

const { activateReviewKey, navigate } = vi.hoisted(() => ({
  activateReviewKey: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("../../commands/host", () => ({
  getCommandUi: () => ({ activateReviewKey, navigate }),
}));

import { CodeHalfHeader } from "./CodeHalfHeader";
import { TooltipProvider } from "../ui/tooltip";
import { openRepoIn } from "./repo-choices";
import { useReviewStore } from "../../stores";
import { attachment, workspace } from "../../test/fixtures";
import type { LocalBranchInfo } from "../../types";

const A = "/repo-a";
const B = "/repo-b";

function branch(name: string): LocalBranchInfo {
  return {
    name,
    isCurrent: true,
    commitsAhead: 0,
    unpushedCommits: 0,
    hasWorkingTreeChanges: false,
    lastCommitDate: new Date().toISOString(),
    lastCommitMessage: "x",
    lastCommitByUser: false,
    worktreePath: null,
    lastModifiedAt: null,
    workingTreeStats: null,
  };
}

/** Both repos registered, each with one branch checked out. */
function seed(attachments = [attachment(A, "main"), attachment(B, "dev")]) {
  const focused = workspace("w", { title: "the work", attachments });
  useReviewStore.setState({
    workspaces: [focused],
    focusedWorkspaceId: "w",
    activeReviewKey: { repoPath: A, ref: "main" },
    localActivity: [
      {
        repoPath: A,
        repoName: "repo-a",
        defaultBranch: "main",
        branches: [branch("main")],
        recentRemoteBranches: [],
      },
      {
        repoPath: B,
        repoName: "repo-b",
        defaultBranch: "dev",
        branches: [branch("dev")],
        recentRemoteBranches: [],
      },
    ],
  });
  return focused;
}

function tabs(): HTMLElement[] {
  return screen
    .getAllByRole("button")
    .filter((el) => /·/.test(el.textContent ?? ""));
}

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    workspaces: [],
    focusedWorkspaceId: null,
    activeReviewKey: null,
    localActivity: [],
    terminalsSupported: false,
    repoPath: null,
    contentFocus: "split",
  });
  vi.clearAllMocks();
});

describe("the repo tab bar", () => {
  it("draws a tab per attachment, in order, marking the one on screen", () => {
    seed();
    render(<CodeHalfHeader />);

    expect(tabs().map((tab) => tab.textContent)).toEqual([
      "repo-a · main",
      "repo-b · dev",
    ]);
    expect(tabs()[0].getAttribute("aria-current")).toBe("true");
    expect(tabs()[1].getAttribute("aria-current")).toBeNull();
  });

  it("opens the attachment's comparison when its tab is clicked", () => {
    seed();
    render(<CodeHalfHeader />);

    fireEvent.click(tabs()[1]);
    expect(activateReviewKey).toHaveBeenCalledWith(B, "dev");
  });

  /**
   * The active tab is matched by repo, so walking that repo's branches keeps
   * the tab you are on rather than dropping the highlight.
   */
  it("stays the active tab across branches of its own repo", () => {
    seed();
    useReviewStore.setState({
      activeReviewKey: { repoPath: A, ref: "some-other-branch" },
    });
    render(<CodeHalfHeader />);

    expect(tabs()[0].getAttribute("aria-current")).toBe("true");
  });

  it("detaches on close, and hands the screen to the neighbour", async () => {
    seed();
    render(<CodeHalfHeader />);

    fireEvent.click(screen.getByLabelText("Close repo-a · main"));

    await vi.waitFor(() =>
      expect(detachWorkspace).toHaveBeenCalledWith("w", A),
    );
    await vi.waitFor(() =>
      expect(activateReviewKey).toHaveBeenCalledWith(B, "dev"),
    );
  });

  /** Closing a tab you are not looking at leaves the screen where it is. */
  it("leaves the screen alone when closing an inactive tab", async () => {
    seed();
    render(<CodeHalfHeader />);

    fireEvent.click(screen.getByLabelText("Close repo-b · dev"));

    await vi.waitFor(() =>
      expect(detachWorkspace).toHaveBeenCalledWith("w", B),
    );
    expect(activateReviewKey).not.toHaveBeenCalled();
  });

  it("shows the empty state when the last tab closes", async () => {
    seed([attachment(A, "main")]);
    render(<CodeHalfHeader />);

    fireEvent.click(screen.getByLabelText("Close repo-a · main"));

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });
});

describe("the code half's Focus toggle", () => {
  /** Nothing to take the stage from when the terminal half isn't drawn. */
  it("stays off the bar while the stage has one half", () => {
    seed();
    render(<CodeHalfHeader />);

    expect(screen.queryByLabelText("Focus")).toBeNull();
  });

  it("gives the code half the stage once there are two", () => {
    seed();
    useReviewStore.setState({ terminalsSupported: true, repoPath: A });
    render(
      <TooltipProvider>
        <CodeHalfHeader />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByLabelText("Focus"));
    expect(useReviewStore.getState().contentFocus).toBe("code");
  });
});

describe("picking a repo", () => {
  it("opens a repo the workspace isn't showing yet", async () => {
    const focused = seed([attachment(A, "main")]);

    await openRepoIn(focused, { path: B, name: "repo-b", refName: "dev" });

    expect(attachWorkspace).toHaveBeenCalledWith("w", B, "dev");
    expect(activateReviewKey).toHaveBeenCalledWith(B, "dev");
  });

  /**
   * Attachments are non-exclusive and identified by path, so picking a repo
   * that is already a tab is not a second tab and not an error — it is how you
   * jump to the tab you already have.
   */
  it("just activates the tab of a repo already open", async () => {
    const focused = seed();

    await openRepoIn(focused, { path: B, name: "repo-b", refName: "dev" });

    expect(attachWorkspace).not.toHaveBeenCalled();
    expect(activateReviewKey).toHaveBeenCalledWith(B, "dev");
  });
});
