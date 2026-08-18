import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Attachment, TerminalSessionInfo } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({}),
}));

vi.mock("./registry", () => ({ disposeTerminal: vi.fn() }));

import { closeTerminalPane } from "./close";
import { useReviewStore } from "../../stores";
import { attachment, workspace } from "../../test/fixtures";

const REMOVED: string[] = [];

function session(id: string, workspaceId: string | null): TerminalSessionInfo {
  return {
    id,
    repoPath: "/repo",
    workspaceId,
    cwd: "/repo",
    title: null,
    cols: 80,
    rows: 24,
    status: {
      id,
      phase: "idle",
      runningCommand: null,
      lastExitCode: null,
      cwd: "/repo",
      title: null,
      enteredStateAt: 0,
      shellIntegrationActive: false,
      attentionMessage: null,
    },
  };
}

/**
 * One workspace holding `sessions`, with the store's kill wired to drop the
 * session the way `killTerminal` does.
 */
function seed(
  overrides: { title?: string | null; attachments?: Attachment[] },
  sessionIds: string[],
): void {
  REMOVED.length = 0;
  const item = workspace("ws-1", {
    title: overrides.title ?? null,
    attachments: overrides.attachments ?? [attachment("/repo", "main")],
  });
  const sessions: Record<string, TerminalSessionInfo> = {};
  for (const id of sessionIds) sessions[id] = session(id, "ws-1");

  useReviewStore.setState({
    workspaces: [item],
    terminalSessions: sessions,
    terminalStatuses: {},
    terminalExited: {},
    killTerminal: async (id: string) => {
      const next = { ...useReviewStore.getState().terminalSessions };
      delete next[id];
      useReviewStore.setState({ terminalSessions: next });
    },
    removeWorkspace: async (id: string) => {
      REMOVED.push(id);
      useReviewStore.setState({
        workspaces: useReviewStore
          .getState()
          .workspaces.filter((entry) => entry.id !== id),
      });
    },
  });
}

describe("closing the last terminal in a workspace", () => {
  beforeEach(() => {
    useReviewStore.setState({ focusedWorkspaceId: null });
  });

  it("drops a workspace nobody named or built out", async () => {
    seed({}, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("drops one with no attachment at all", async () => {
    seed({ attachments: [] }, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("keeps one the user named", async () => {
    seed({ title: "the migration" }, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual([]);
  });

  it("keeps one showing more than one repo", async () => {
    seed({ attachments: [attachment("/repo"), attachment("/other")] }, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual([]);
  });

  it("does not wait for the teardown to reach the store", async () => {
    // The reap answers from the ids it is closing, not from whether
    // `killTerminal` happened to drop its session first — so a kill that
    // resolves without touching the map reaps exactly the same.
    seed({}, ["t1"]);
    useReviewStore.setState({ killTerminal: async () => {} });
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("keeps one that still has a terminal running", async () => {
    seed({}, ["t1", "t2"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual([]);

    // ...and goes once the second one closes too.
    await closeTerminalPane("t2");
    expect(REMOVED).toEqual(["ws-1"]);
  });
});
