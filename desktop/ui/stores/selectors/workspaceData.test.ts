import { describe, it, expect } from "vitest";
import {
  attachmentLabel,
  comparisonTarget,
  focusedWorkspace,
  hasRef,
  previewRoute,
  repoHosts,
} from "./workspaceData";
import { routePreviewLabel } from "../../components/palette/route-preview";
import { attachment, workspace } from "../../test/fixtures";

const REPO = "/repo";

describe("the router preview", () => {
  const queue = [
    workspace("a", {
      title: "reserved tunnels",
      attachments: [attachment(REPO, "tunnels")],
    }),
    workspace("b", { attachments: [attachment("/other", "main")] }),
  ];

  it("joins the workspace already showing the repo", () => {
    const preview = previewRoute(queue, REPO);
    expect(preview).toEqual({ kind: "join", workspace: queue[0] });
    expect(routePreviewLabel(preview)).toBe("→ joins reserved tunnels");
  });

  it("starts a new workspace when nothing shows it", () => {
    const preview = previewRoute(queue, "/elsewhere");
    expect(preview).toEqual({ kind: "new" });
    expect(routePreviewLabel(preview)).toBe("→ new workspace");
  });

  /**
   * The repo is the whole question now: another branch of a repo a workspace
   * already shows joins that workspace, because a ref is a view hint rather
   * than something a workspace holds.
   */
  it("ignores the ref", () => {
    expect(previewRoute(queue, REPO)).toEqual({
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
    expect(previewRoute([...queue, second], REPO)).toEqual({
      kind: "join",
      workspace: queue[0],
    });
    expect(previewRoute([second, ...queue], REPO)).toEqual({
      kind: "join",
      workspace: second,
    });
  });

  /** A workspace with no title of its own is named by what it shows. */
  it("names an untitled joined workspace by its derived title", () => {
    expect(routePreviewLabel(previewRoute(queue, "/other"))).toBe(
      "→ joins other · main",
    );
  });
});

describe("repoHosts", () => {
  it("keeps the first workspace showing each repo", () => {
    const first = workspace("a", { attachments: [attachment(REPO, "x")] });
    const second = workspace("b", {
      attachments: [attachment(REPO, "y"), attachment("/other", null)],
    });
    const hosts = repoHosts([first, second]);
    expect(hosts.get(REPO)).toBe(first);
    expect(hosts.get("/other")).toBe(second);
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

  it("comparisonTarget takes the first attachment with a ref", () => {
    const ws = workspace("w", {
      attachments: [attachment("/tmp/scratch"), attachment("/r", "main")],
    });
    expect(comparisonTarget(ws)).toEqual({ repoPath: "/r", ref: "main" });
    expect(comparisonTarget(workspace("w"))).toBeNull();
    expect(comparisonTarget(null)).toBeNull();
  });
});

describe("focusedWorkspace", () => {
  const explicit = workspace("a", { attachments: [attachment("/a", "x")] });
  const showing = workspace("b", { attachments: [attachment(REPO, "main")] });
  const queue = [explicit, showing];

  it("prefers the explicit pick", () => {
    expect(focusedWorkspace(queue, "a", { repoPath: REPO, ref: "main" })).toBe(
      explicit,
    );
  });

  /** By repo, not by ref: walking a repo's branches never leaves its tab. */
  it("derives from the repo on screen, whatever the branch", () => {
    expect(
      focusedWorkspace(queue, null, { repoPath: REPO, ref: "other" }),
    ).toBe(showing);
  });

  it("is null when nothing shows the repo on screen", () => {
    expect(
      focusedWorkspace(queue, null, { repoPath: "/nowhere", ref: "main" }),
    ).toBeNull();
    expect(focusedWorkspace(queue, null, null)).toBeNull();
  });
});
