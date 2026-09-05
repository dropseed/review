import { vi, describe, it, expect, afterEach } from "vitest";

// `routeWorkspace` is the backend's router (`workspace_route`); what it decides has
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
  openRowInWorkspace,
  workspaceCommands,
} from "./workspaceCommands";
import { getSidebarTree } from "../stores/selectors/sidebar";
import { allSidebarRows } from "../utils/sidebar-tree";
import { useSpurStore } from "../stores";
import { toAccelerator } from "./shortcuts";
import { attachment, workspace } from "../test/fixtures";
import type { LocalBranchInfo, Workspace } from "../types";

const REPO = "/repo";
const OTHER = "/other";
/** A linked worktree of REPO: its own tab, filed under REPO's reviews. */
const WORKTREE = "/worktrees/repo-wt";

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
  useSpurStore.setState({
    workspaces: items,
    localActivity: [
      repoActivity(REPO, branches),
      repoActivity(OTHER, [branch("other")]),
    ],
  });
}

afterEach(() => {
  useSpurStore.setState({
    workspaces: [],
    localActivity: [],
    focusedWorkspaceId: null,
    activeReviewKey: null,
    workspaceCodeKeys: {},
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
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("cli");
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

    expect(useSpurStore.getState().workspaces).toEqual([landed]);
    expect(listWorkspaces).not.toHaveBeenCalled();
  });

  /** An unchanged list keeps its array: the caches key on that identity. */
  it("keeps the old array when the route changed nothing", async () => {
    const before = [landed];
    seed(before);
    // A distinct but equal object, the way a fresh deserialization arrives.
    routesTo(item("cli", { attachments: [attachment(REPO, "feature")] }));

    await landWorkspace(REPO, "feature");

    expect(useSpurStore.getState().workspaces).toBe(before);
  });

  /** Routing is the one thing that can fail, and it costs the focus only. */
  it("leaves the focus alone when routing fails", async () => {
    seed([item("a")]);
    useSpurStore.setState({ focusedWorkspaceId: "a" });
    routeWorkspace.mockRejectedValue(new Error("no daemon"));

    expect(await landWorkspace(REPO, "feature")).toBeNull();
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("a");
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
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("a");
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
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("a");

    useSpurStore
      .getState()
      .setActiveReviewKey({ repoPath: OTHER, ref: "other" });
    expect(useSpurStore.getState().focusedWorkspaceId).toBeNull();
  });

  /** A ref is a hint: another branch of the same repo is still that tab. */
  it("keeps the explicit focus across branches of a repo it shows", () => {
    seed([item("a")]);
    focusWorkspace(item("a"));
    useSpurStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "something-else" });
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("a");
  });

  /**
   * The app's most-repeated gesture: the card you are working in is the one
   * nearest the pointer, and clicking it used to throw away the tab you had
   * chosen, the file you were on and the scroll with it.
   */
  it("leaves the code half alone when the workspace is already on screen", () => {
    seed([item("a")]);
    focusWorkspace(item("a"));
    expect(activateReviewKey).toHaveBeenCalledTimes(1);

    // What the real activation would have written back.
    useSpurStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "feature" });
    activateReviewKey.mockClear();
    navigate.mockClear();

    focusWorkspace(item("a"));

    expect(activateReviewKey).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // The rest of the gesture still happens.
    expect(useSpurStore.getState().focusedWorkspaceId).toBe("a");
  });

  /** A caller naming a comparison always wins, on-screen or not. */
  it("still opens an explicitly named target on the focused workspace", () => {
    seed([item("a")]);
    focusWorkspace(item("a"));
    useSpurStore
      .getState()
      .setActiveReviewKey({ repoPath: REPO, ref: "feature" });
    activateReviewKey.mockClear();

    focusWorkspace(item("a"), { repoPath: REPO, ref: "feature" });

    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
  });

  describe("the tab a workspace was left on", () => {
    const both = {
      attachments: [attachment(REPO, "feature"), attachment(OTHER, "other")],
    };

    /**
     * Every route into a workspace used to re-open `attachments[0]`, so walking
     * away from a two-repo workspace and back silently moved you to its first
     * tab. The terminal half already restored its own tab; this is the code
     * half's half of that.
     */
    it("re-opens the second tab rather than the first", () => {
      seed([
        item("a", both),
        item("b", { attachments: [attachment(OTHER, "other")] }),
      ]);
      focusWorkspace(item("a", both));
      // Walk to the second tab, the way clicking it would.
      useSpurStore
        .getState()
        .setActiveReviewKey({ repoPath: OTHER, ref: "other" });

      focusWorkspace(item("b", { attachments: [attachment(OTHER, "other")] }));
      activateReviewKey.mockClear();
      focusWorkspace(item("a", both));

      expect(activateReviewKey).toHaveBeenCalledWith(OTHER, "other");
    });

    /** A detached tab must not resurrect: the repo has to still be attached. */
    it("falls back to the first tab when the remembered repo is gone", () => {
      seed([item("a", both)]);
      focusWorkspace(item("a", both));
      useSpurStore
        .getState()
        .setActiveReviewKey({ repoPath: OTHER, ref: "other" });

      const detached = { attachments: [attachment(REPO, "feature")] };
      seed([item("a", detached)]);
      activateReviewKey.mockClear();
      focusWorkspace(item("a", detached));

      expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
    });

    /** A workspace nobody has opened has nothing remembered. */
    it("opens the first tab of a workspace with no history", () => {
      seed([item("a", both)]);
      focusWorkspace(item("a", both));
      expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
    });

    /**
     * Two checkouts of *one* repository: the memory has to be the tab rather
     * than the repo, or coming back would land on whichever of them the
     * workspace lists first.
     */
    it("re-opens the worktree tab of a repo it shows twice", () => {
      const twice = {
        attachments: [
          attachment(REPO, "feature"),
          attachment(WORKTREE, "wt-branch", true, REPO),
        ],
      };
      seed(
        [item("a", twice), item("b")],
        [branch("feature"), branch("wt-branch")],
      );
      focusWorkspace(item("a", twice));
      // Walk to the worktree tab, the way clicking it would.
      useSpurStore
        .getState()
        .setActiveReviewKey({ repoPath: REPO, ref: "wt-branch" });
      expect(useSpurStore.getState().activeReviewKey?.path).toBe(WORKTREE);

      focusWorkspace(item("b"));
      activateReviewKey.mockClear();
      focusWorkspace(item("a", twice));

      expect(activateReviewKey).toHaveBeenCalledWith(REPO, "wt-branch");
    });
  });

  /**
   * ⌘K's Enter on a row living in a linked worktree. It routes by the
   * *checkout* — so a workspace already holding that worktree wins over one
   * holding only the main tree — while the comparison it opens is still the
   * repository's.
   */
  it("routes a worktree row by the checkout it lives in", async () => {
    const inWorktree = { ...branch("feature"), worktreePath: WORKTREE };
    seed([], [inWorktree]);
    const landed = item("a", {
      attachments: [attachment(WORKTREE, "feature", true, REPO)],
    });
    routeWorkspace.mockResolvedValue({
      workspace: landed,
      created: false,
      workspaces: [landed],
    });

    const row = allSidebarRows(getSidebarTree(useSpurStore.getState())).find(
      (candidate) => candidate.repoPath === REPO && candidate.ref === "feature",
    );
    expect(row?.checkoutPath).toBe(WORKTREE);
    await openRowInWorkspace(row!);

    expect(routeWorkspace).toHaveBeenCalledWith(WORKTREE, "feature", undefined);
    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
  });

  /**
   * A checkout is a tab, and the review is still the repository's — so a
   * workspace holding nothing but a worktree opens the repo's row for the
   * branch that worktree has out. Keyed by the worktree's own path it would
   * find no row at all and open nothing.
   */
  it("opens a worktree tab against its repository's row", () => {
    const only = {
      attachments: [attachment(WORKTREE, "feature", true, REPO)],
    };
    seed([item("a", only)]);
    focusWorkspace(item("a", only));
    expect(activateReviewKey).toHaveBeenCalledWith(REPO, "feature");
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
