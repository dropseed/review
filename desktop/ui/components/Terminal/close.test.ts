import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Attachment, TerminalSessionInfo } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({}),
}));

vi.mock("./registry", () => ({ disposeTerminal: vi.fn() }));

const confirm = vi.hoisted(() =>
  vi.fn(async (_message: string, _title?: string) => true),
);
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({ dialogs: { confirm } }),
}));

import { closeTerminalPane, removeWorkspaceAndTerminals } from "./close";
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
  confirm.mockClear();
  confirm.mockResolvedValue(true);
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

describe("removing a workspace", () => {
  it("kills the terminals in it", async () => {
    seed({ title: "the migration" }, ["t1", "t2"]);
    // A workspace with someone's title on it — the reap never touches this
    // one, so what removes it is the removal itself.
    expect(await removeWorkspaceAndTerminals("ws-1")).toBe(true);
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([]);
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("asks first, naming what is running", async () => {
    seed({ title: "the migration" }, ["t1"]);
    useReviewStore.setState({
      terminalStatuses: {
        t1: { runningCommand: "npm test", title: "claude" } as never,
      },
    });
    await removeWorkspaceAndTerminals("ws-1");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("claude is running `npm test`");
    expect(confirm.mock.calls[0][0]).toContain("its terminal");
  });

  it("keeps everything when the answer is no", async () => {
    seed({ title: "the migration" }, ["t1"]);
    confirm.mockResolvedValue(false);
    expect(await removeWorkspaceAndTerminals("ws-1")).toBe(false);
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([
      "t1",
    ]);
    expect(REMOVED).toEqual([]);
  });

  it("does not ask when there is nothing live to lose", async () => {
    seed({ title: "the migration" }, []);
    await removeWorkspaceAndTerminals("ws-1");
    expect(confirm).not.toHaveBeenCalled();
    expect(REMOVED).toEqual(["ws-1"]);

    // ...nor for panes whose shell has already exited.
    seed({ title: "the migration" }, ["t1"]);
    useReviewStore.setState({ terminalExited: { t1: {} as never } });
    await removeWorkspaceAndTerminals("ws-1");
    expect(confirm).not.toHaveBeenCalled();
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("leaves another workspace's terminals alone", async () => {
    seed({ title: "the migration" }, ["t1", "t2"]);
    useReviewStore.setState({
      terminalSessions: {
        ...useReviewStore.getState().terminalSessions,
        t3: session("t3", "ws-2"),
      },
    });
    await removeWorkspaceAndTerminals("ws-1");
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([
      "t3",
    ]);
  });
});
