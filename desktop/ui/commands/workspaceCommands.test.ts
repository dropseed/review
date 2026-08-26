import { vi, describe, it, expect, afterEach } from "vitest";

// `routeWorkspace` is the backend's router (`work_route`); what it decides has
// its own tests on both sides. Here it only has to answer, so the landing can
// be checked against it.
const { routeWorkspace, listWorkspaces } = vi.hoisted(() => ({
  routeWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("../api", () => ({
  getApiClient: () => ({ listWorkspaces, routeWorkspace }),
}));

const activateReviewKey = vi.fn();
const openPath = vi.fn();
const navigate = vi.fn();
vi.mock("./host", () => ({
  getCommandUi: () => ({ activateReviewKey, openPath, navigate }),
}));

import {
  focusWorkspace,
  landWorkspace,
  workspaceCommands,
} from "./workspaceCommands";
import { useReviewStore } from "../stores";
import { toAccelerator } from "./shortcuts";
import { attachment, workspace } from "../test/fixtures";
import type { LocalBranchInfo, Workspace } from "../types";

const REPO = "/repo";
const OTHER = "/other";

function item(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return workspace(id, {
    attachments: [attachment(REPO, "feature")],
    ...overrides,
  });
}

function branch(name: string): LocalBranchInfo {
  return {
    name,
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
  };
}

function repoActivity(repoPath: string, branches: LocalBranchInfo[]) {
  return {
    repoPath,
    repoName: repoPath.slice(1),
    defaultBranch: "main",
    branches,
    recentRemoteBranches: [],
  };
}

function seed(items: Workspace[], branches = [branch("feature")]): void {
  useReviewStore.setState({
    workspaces: items,
    localActivity: [
      repoActivity(REPO, branches),
      repoActivity(OTHER, [branch("other")]),
    ],
  });
}

afterEach(() => {
  useReviewStore.setState({
    workspaces: [],
    localActivity: [],
    focusedWorkspaceId: null,
    activeReviewKey: null,
  });
  vi.clearAllMocks();
  routeWorkspace.mockReset();
  listWorkspaces.mockReset();
});

/** A landing from outside the app. See the `land*` wrappers in
 *  `hooks/useRepositoryInit.ts` for what this is for and why it routes first. */
describe("landing something from outside the app", () => {
  const landed = item("cli", { attachments: [attachment(REPO, "feature")] });

  function routesTo(workspace: Workspace): void {
    // The route answers with the whole queue, so the landing needs no second
    // read — `listWorkspaces` staying unmocked is part of what these assert.
    routeWorkspace.mockResolvedValue({
      workspace,
      created: false,
      workspaces: [workspace],
    });
  }

  it("routes by the repo and ref, and focuses where it landed", async () => {
    seed([]);
    routesTo(landed);

    expect(await landWorkspace(REPO, "feature")).toBe(landed);

    expect(routeWorkspace).toHaveBeenCalledWith(REPO, "feature", undefined);
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("cli");
  });

  /**
   * `review <path>` names no branch. The empty ref is `CHECKOUT_REF`, which the
   * backend reads as a bare path attachment.
   */
  it("lands a path with no ref on the checkout", async () => {
    seed([]);
    routesTo(landed);

    await landWorkspace(REPO, null);

    expect(routeWorkspace).toHaveBeenCalledWith(REPO, "", undefined);
  });

  /**
   * It takes the focus and not the screen: the caller owns the comparison,
   * because it carries `ensureReviewExists`, the session record and the
   * deep-link ordering that a generic activate does not.
   */
  it("opens no comparison of its own", async () => {
    seed([]);
    routesTo(landed);

    await landWorkspace(REPO, "feature");

    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * The queue comes back on the response, so the landing costs one round trip.
   * It used to re-read, which is a second one on the path every CLI landing and
   * every page refresh now takes.
   */
  it("takes the queue off the response without a second read", async () => {
    seed([]);
    routesTo(landed);

    await landWorkspace(REPO, "feature");

    expect(useReviewStore.getState().workspaces).toEqual([landed]);
    expect(listWorkspaces).not.toHaveBeenCalled();
  });

  /** An unchanged list keeps its array: the caches key on that identity. */
  it("keeps the old array when the route changed nothing", async () => {
    const before = [landed];
    seed(before);
    // A distinct but equal object, the way a fresh deserialization arrives.
    routesTo(item("cli", { attachments: [attachment(REPO, "feature")] }));

    await landWorkspace(REPO, "feature");

    expect(useReviewStore.getState().workspaces).toBe(before);
  });

  /** Routing is the one thing that can fail, and it costs the focus only. */
  it("leaves the focus alone when routing fails", async () => {
    seed([item("a")]);
    useReviewStore.setState({ focusedWorkspaceId: "a" });
    routeWorkspace.mockRejectedValue(new Error("no daemon"));

    expect(await landWorkspace(REPO, "feature")).toBeNull();
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");
  });
});

describe("⌘1–9 over the workspace queue", () => {
  it("binds the digits to the first nine cards, in the user's order", () => {
    seed(Array.from({ length: 11 }, (_, i) => item(`w${i}`)));
    const accelerators = workspaceCommands().map((c) =>
      c.shortcut ? toAccelerator(c.shortcut) : null,
    );

    expect(accelerators.slice(0, 9)).toEqual([
      "CmdOrCtrl+1",
      "CmdOrCtrl+2",
      "CmdOrCtrl+3",
      "CmdOrCtrl+4",
      "CmdOrCtrl+5",
      "CmdOrCtrl+6",
      "CmdOrCtrl+7",
      "CmdOrCtrl+8",
      "CmdOrCtrl+9",
    ]);
    // The rest are findable by typing, which is the whole reason these are
    // commands rather than nine positional key handlers.
    expect(accelerators.slice(9)).toEqual([null, null]);
  });

  it("titles an entry by the title the backend derived for it", () => {
    seed([item("a", { title: "Ship the thing" }), item("b")]);
    expect(workspaceCommands().map((c) => c.title)).toEqual([
      "Ship the thing",
      "repo · feature",
    ]);
  });

  it("opens the workspace's first repo tab", () => {
    seed([item("a")]);
    focusWorkspace(item("a"));
    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");
  });

  /**
   * A workspace with nothing to compare goes to its empty state rather than
   * leaving the previous workspace's diff on screen under this one's name.
   */
  it("sends a workspace showing no repo to its empty state", () => {
    seed([item("a", { attachments: [] })]);
    focusWorkspace(item("a", { attachments: [] }));
    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
  });

  /**
   * An attachment with no ref names no branch, so there is no comparison — but
   * there is still a folder, and that is what opens. The empty state is for a
   * workspace with nothing attached at all.
   */
  it("opens a ref-less attachment as the folder it is", () => {
    const only = { attachments: [attachment("/tmp/scratch")] };
    seed([item("a", only)]);
    focusWorkspace(item("a", only));
    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(openPath).toHaveBeenCalledWith("/tmp/scratch");
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * The freshly `git init`-ed repo: attached, real, full of files, and with no
   * commit for the sidebar to build a row out of. It used to fall through to
   * the empty state, which read as the attach having silently failed.
   */
  it("opens a repo the sidebar hasn't heard of yet", () => {
    const only = { attachments: [attachment("/new/repo")] };
    seed([item("a", only)]);
    focusWorkspace(item("a", only));
    expect(openPath).toHaveBeenCalledWith("/new/repo");
    expect(navigate).not.toHaveBeenCalled();
  });

  /** A plain directory has no branches, so a ref on one names nothing. */
  it("opens a directory as a folder even when a ref is stored on it", () => {
    const only = {
      attachments: [{ ...attachment("/tmp/notes", "main"), isGitRepo: false }],
    };
    seed([item("a", only)]);
    focusWorkspace(item("a", only));
    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(openPath).toHaveBeenCalledWith("/tmp/notes");
  });

  /**
   * The dual-source-of-truth bug: focus was written and never cleared, so
   * opening another workspace's branch left the first workspace's header and
   * terminals over the second one's diff. Derivation is authoritative — the
   * explicit pick only survives while the repo on screen is one it shows.
   */
  it("drops the explicit focus when the repo on screen moves out of it", () => {
    seed([item("a"), item("b", { attachments: [attachment(OTHER, "other")] })]);
    focusWorkspace(item("a"));
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");

    useReviewStore
      .getState()
      .setActiveReviewKey({ repoPath: OTHER, ref: "other" });
    expect(useReviewStore.getState().focusedWorkspaceId).toBeNull();
  });

  /** A ref is a hint: another branch of the same repo is still that tab. */
  it("keeps the explicit focus across branches of a repo it shows", () => {
    seed([item("a")]);
    focusWorkspace(item("a"));
    useReviewStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "something-else" });
    expect(useReviewStore.getState().focusedWorkspaceId).toBe("a");
  });

  it("stages the intent when the attached branch is gone", () => {
    // Opening a review of a ref that no longer exists is worse than showing
    // nothing — and leaving the *previous* workspace's diff under this one's
    // name is worse still, so it lands on the empty state.
    seed([item("a")], [branch("something-else")]);
    focusWorkspace(item("a"));
    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
