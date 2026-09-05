import { describe, it, expect } from "vitest";
import {
  attachmentLabel,
  comparisonTarget,
  focusedWorkspace,
  hasRef,
  isWorktreeTab,
  previewRouteIn,
  repoHosts,
  repoOnScreen,
  withTabPath,
} from "./workspaceData";
import { routePreviewLabel } from "../../components/palette/route-preview";
import { attachment, workspace } from "../../test/fixtures";

const REPO = "/repo";
/** A linked worktree of REPO — its own checkout, filed under the same repo. */
const WORKTREE = "/worktrees/spur-feature";

describe("the router preview", () => {
  const queue = [
    workspace("a", {
      title: "reserved tunnels",
      attachments: [attachment(REPO, "tunnels")],
    }),
    workspace("b", { attachments: [attachment("/other", "main")] }),
  ];

  it("joins the workspace already showing the repo", () => {
    const preview = previewRouteIn(repoHosts(queue), REPO, REPO);
    expect(preview).toEqual({ kind: "join", workspace: queue[0] });
    expect(routePreviewLabel(preview)).toBe("→ joins reserved tunnels");
  });

  it("starts a new workspace when nothing shows it", () => {
    const preview = previewRouteIn(
      repoHosts(queue),
      "/elsewhere",
      "/elsewhere",
    );
    expect(preview).toEqual({ kind: "new" });
    expect(routePreviewLabel(preview)).toBe("→ new workspace");
  });

  /**
   * The repo is the whole question now: another branch of a repo a workspace
   * already shows joins that workspace, because a ref is a view hint rather
   * than something a workspace holds.
   */
  it("ignores the ref", () => {
    expect(previewRouteIn(repoHosts(queue), REPO, REPO)).toEqual({
      kind: "join",
      workspace: queue[0],
    });
  });

  /** Non-exclusive: several workspaces may show one repo, and order decides. */
  it("names the first workspace in queue order", () => {
    const second = workspace("c", {
      title: "later",
      attachments: [attachment(REPO, "other")],
    });
    expect(previewRouteIn(repoHosts([...queue, second]), REPO, REPO)).toEqual({
      kind: "join",
      workspace: queue[0],
    });
    expect(previewRouteIn(repoHosts([second, ...queue]), REPO, REPO)).toEqual({
      kind: "join",
      workspace: second,
    });
  });

  /** A workspace with no title of its own is named by what it shows. */
  it("names an untitled joined workspace by its derived title", () => {
    expect(
      routePreviewLabel(previewRouteIn(repoHosts(queue), "/other", "/other")),
    ).toBe("→ joins other · main");
  });
});

describe("repoHosts", () => {
  it("keeps the first workspace showing each repo", () => {
    const first = workspace("a", { attachments: [attachment(REPO, "x")] });
    const second = workspace("b", {
      attachments: [attachment(REPO, "y"), attachment("/other", null)],
    });
    const hosts = repoHosts([first, second]);
    expect(hosts.byPath.get(REPO)).toBe(first);
    expect(hosts.byRoot.get(REPO)).toBe(first);
    expect(hosts.byPath.get("/other")).toBe(second);
  });

  /**
   * The two rungs are ordered: a workspace holding the exact checkout beats an
   * earlier one holding only another checkout of the same repository — which a
   * single first-wins map could not express.
   */
  it("prefers the workspace holding the checkout itself", () => {
    const main = workspace("a", { attachments: [attachment(REPO, "main")] });
    const tree = workspace("b", {
      attachments: [attachment(WORKTREE, "feature", true, REPO)],
    });
    const hosts = repoHosts([main, tree]);
    expect(previewRouteIn(hosts, WORKTREE, REPO)).toEqual({
      kind: "join",
      workspace: tree,
    });
    // ...and a checkout nobody holds falls back to the repository's host.
    expect(previewRouteIn(hosts, "/worktrees/spur-other", REPO)).toEqual({
      kind: "join",
      workspace: main,
    });
  });
});

describe("the attachment predicates", () => {
  it("hasRef separates a branch tab from a bare repo", () => {
    expect(hasRef(attachment("/r", "main"))).toBe(true);
    expect(hasRef(attachment("/tmp/scratch"))).toBe(false);
  });

  it("attachmentLabel appends the ref only when there is one", () => {
    expect(attachmentLabel(attachment("/a/review", "feature"))).toBe(
      "review · feature",
    );
    expect(attachmentLabel(attachment("/a/review"))).toBe("review");
    expect(
      attachmentLabel(attachment("/a/review", "feature"), "owner-repo"),
    ).toBe("owner-repo · feature");
  });

  /** A plain directory is its own repo root, so it is not a second tab. */
  it("isWorktreeTab is true only for a checkout that isn't the repo's tree", () => {
    expect(isWorktreeTab(attachment(REPO, "main"))).toBe(false);
    expect(isWorktreeTab(attachment("/tmp/scratch", null, false))).toBe(false);
    expect(isWorktreeTab(attachment(WORKTREE, "feature", true, REPO))).toBe(
      true,
    );
  });

  /**
   * The repo's name is exactly what a worktree tab shares with the main tree's,
   * so it is the directory that tells them apart.
   */
  it("attachmentLabel names a worktree by its own directory", () => {
    expect(
      attachmentLabel(
        attachment(WORKTREE, "feature", true, REPO),
        "owner-repo",
      ),
    ).toBe("spur-feature · feature");
    expect(
      attachmentLabel(
        attachment("/worktrees/spur-hotfix", null, true, REPO),
        "owner-repo",
      ),
    ).toBe("spur-hotfix");
  });

  it("comparisonTarget takes the first attachment with a ref", () => {
    const ws = workspace("w", {
      attachments: [attachment("/tmp/scratch"), attachment("/r", "main")],
    });
    expect(comparisonTarget(ws)).toEqual({
      repoPath: "/r",
      ref: "main",
      path: "/r",
    });
    expect(comparisonTarget(workspace("w"))).toBeNull();
    expect(comparisonTarget(null)).toBeNull();
  });

  /** The review is the repository's; the tab is the checkout it is read in. */
  it("comparisonTarget files a worktree tab under its repository", () => {
    const ws = workspace("w", {
      attachments: [attachment(WORKTREE, "feature", true, REPO)],
    });
    expect(comparisonTarget(ws)).toEqual({
      repoPath: REPO,
      ref: "feature",
      path: WORKTREE,
    });
  });
});

describe("focusedWorkspace", () => {
  const explicit = workspace("a", { attachments: [attachment("/a", "x")] });
  const showing = workspace("b", { attachments: [attachment(REPO, "main")] });
  const queue = [explicit, showing];

  it("prefers the explicit pick", () => {
    expect(focusedWorkspace(queue, "a", REPO)).toBe(explicit);
  });

  /** By repo, not by ref: walking a repo's branches never leaves its tab. */
  it("derives from the repo on screen, whatever the branch", () => {
    expect(focusedWorkspace(queue, null, REPO)).toBe(showing);
  });

  it("is null when nothing shows the repo on screen", () => {
    expect(focusedWorkspace(queue, null, "/nowhere")).toBeNull();
    expect(focusedWorkspace(queue, null, null)).toBeNull();
  });

  /**
   * A workspace holding only a worktree is still the one showing it — the
   * screen names a checkout, and that is the coordinate its tabs are keyed by.
   */
  it("derives from a worktree tab on screen", () => {
    const tree = workspace("c", {
      attachments: [attachment(WORKTREE, "feature", true, REPO)],
    });
    expect(focusedWorkspace([...queue, tree], null, WORKTREE)).toBe(tree);
  });

  /**
   * `showingRepo`'s second rung: the screen names the repository's own tree —
   * which is what an unresolved tab resolves to — and the only workspace
   * showing that repository shows it through a worktree.
   */
  it("falls back to a workspace holding any checkout of the repo", () => {
    const tree = workspace("c", {
      attachments: [attachment(WORKTREE, "feature", true, REPO)],
    });
    expect(focusedWorkspace([explicit, tree], null, REPO)).toBe(tree);
    // ...and the checkout itself still wins over it, whatever the order.
    expect(focusedWorkspace([tree, showing], null, REPO)).toBe(showing);
  });
});

describe("repoOnScreen", () => {
  it("names the comparison's repo when there is one", () => {
    expect(
      repoOnScreen({
        activeReviewKey: { path: REPO },
        repoPath: "/stale",
      }),
    ).toBe(REPO);
  });

  /**
   * With two checkouts of one repository open, the repository does not say
   * which tab is on screen and the resolved path does.
   */
  it("prefers the checkout the comparison was opened in", () => {
    expect(
      repoOnScreen({
        activeReviewKey: { path: WORKTREE },
        repoPath: REPO,
      }),
    ).toBe(WORKTREE);
  });

  /**
   * Browse and standalone mode have no comparison at all, and are still a repo
   * somebody is looking at — which is the whole reason the focus can't be
   * derived from the comparison alone.
   */
  it("falls back to the path when nothing is being compared", () => {
    expect(repoOnScreen({ activeReviewKey: null, repoPath: REPO })).toBe(REPO);
    expect(repoOnScreen({ activeReviewKey: null, repoPath: null })).toBeNull();
  });
});

/**
 * Which of a workspace's checkouts a comparison is shown in. Almost every route
 * — a sidebar row, ⌘K, a PR — names a repository and a ref and no tab, so this
 * is where the tab is decided.
 */
describe("withTabPath", () => {
  const tabs = [
    attachment(REPO, "main"),
    attachment(WORKTREE, "feature", true, REPO),
  ];

  it("prefers the checkout already pointed at the ref", () => {
    expect(withTabPath({ repoPath: REPO, ref: "feature" }, tabs)).toEqual({
      repoPath: REPO,
      ref: "feature",
      path: WORKTREE,
    });
  });

  /** A branch neither tab has out belongs in the repository's own tree. */
  it("falls back to the repository's own tree", () => {
    expect(withTabPath({ repoPath: REPO, ref: "other" }, tabs).path).toBe(REPO);
  });

  it("falls back to the first checkout of the repo when it has no tree tab", () => {
    expect(
      withTabPath({ repoPath: REPO, ref: "other" }, [
        attachment(WORKTREE, "feature", true, REPO),
      ]).path,
    ).toBe(WORKTREE);
  });

  /**
   * The repository's own tree when the workspace holds no checkout of it: an
   * answer the staleness rule can then reject, rather than an absent one every
   * reader downstream would have to have a second branch for.
   */
  it("falls back to the repository when the workspace shows no checkout of it", () => {
    expect(
      withTabPath({ repoPath: REPO, ref: "main" }, [attachment("/other", "x")]),
    ).toEqual({ repoPath: REPO, ref: "main", path: REPO });
  });
});
