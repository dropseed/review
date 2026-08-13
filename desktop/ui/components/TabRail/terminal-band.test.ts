import { describe, it, expect } from "vitest";
import { terminalBandRows, type TerminalBandInput } from "./terminal-band";
import type { WorkContext } from "./work-status";
import { makeTab } from "../Terminal/pane-tree";
import { buildSidebarTree, allSidebarRows } from "../../utils/sidebar-tree";
import type { TerminalSessionInfo } from "../../types";

const REPO = "/repo";

/** A context built from the real tree, so the band can't drift from the rows. */
function context(): WorkContext {
  const tree = buildSidebarTree([], [], {}, []);
  return {
    rows: new Map(allSidebarRows(tree).map((row) => [row.reviewKey, row])),
    repoNames: new Map([[REPO, "repo"]]),
    knownRepos: new Set([REPO]),
    reviews: {},
  };
}

function input(overrides: Partial<TerminalBandInput> = {}): TerminalBandInput {
  return { tabIds: [], tabs: [], sessions: {}, ...overrides };
}

function session(id: string, repoPath = REPO): TerminalSessionInfo {
  return {
    id,
    repoPath,
    cwd: repoPath,
    title: `sh ${id}`,
    cols: 80,
    rows: 24,
  } as TerminalSessionInfo;
}

describe("what the unclaimed-terminals band shows", () => {
  it("shows nothing when no tab is unclaimed", () => {
    expect(terminalBandRows(context(), input())).toEqual([]);
  });

  it("names a tab by the repo it runs in, keeping the given order", () => {
    const rows = terminalBandRows(
      context(),
      input({
        tabIds: ["t2", "t1"],
        tabs: [makeTab("t1", "s1"), makeTab("t2", "s2")],
        sessions: { s1: session("s1"), s2: session("s2") },
      }),
    );
    expect(rows).toEqual([
      { key: "t:t2", tabId: "t2", repoName: "repo" },
      { key: "t:t1", tabId: "t1", repoName: "repo" },
    ]);
  });

  it("names a terminal in a repo it knows nothing about", () => {
    const [row] = terminalBandRows(
      context(),
      input({ tabIds: ["t1"], tabs: [makeTab("t1", "s1")], sessions: {} }),
    );
    expect(row).toMatchObject({ tabId: "t1", repoName: "shell" });
  });
});
