import { describe, it, expect } from "vitest";
import {
  hasNeedsYou,
  needsYouQueue,
  overviewGroups,
  primaryStatus,
  sessionTitle,
  tabGlance,
  tailLines,
} from "./glance";
import { makeTab } from "./pane-tree";
import { terminalSession, terminalStatus } from "../../test/fixtures";
import type { TerminalSessionInfo, TerminalStatus } from "../../types";

describe("primaryStatus", () => {
  it("picks the most severe phase", () => {
    const working = terminalStatus("working", { id: "a" });
    const attention = terminalStatus("needs_attention", { id: "b" });
    expect(primaryStatus([working, attention])?.id).toBe("b");
  });

  it("breaks ties toward the longest-waiting session", () => {
    const newer = terminalStatus("needs_attention", {
      id: "new",
      enteredStateAt: 2000,
    });
    const older = terminalStatus("needs_attention", {
      id: "old",
      enteredStateAt: 1000,
    });
    expect(primaryStatus([newer, older])?.id).toBe("old");
  });

  it("returns null for no sessions", () => {
    expect(primaryStatus([])).toBeNull();
  });
});

describe("sessionTitle", () => {
  it("prefers the status title, then session title, then cwd basename", () => {
    const session = terminalSession("t1", { title: "vi", cwd: "/repo/sub" });
    expect(
      sessionTitle(terminalStatus("idle", { title: "claude" }), session),
    ).toBe("claude");
    expect(sessionTitle(terminalStatus("idle"), session)).toBe("vi");
    expect(
      sessionTitle(
        terminalStatus("idle"),
        terminalSession("t1", { cwd: "/repo/sub" }),
      ),
    ).toBe("sub");
    expect(sessionTitle(undefined, undefined)).toBe("shell");
  });
});

describe("tabGlance", () => {
  it("summarizes a tab from its focused pane and worst status", () => {
    const tab = makeTab("tab1", "a");
    const glance = tabGlance(
      tab,
      { a: terminalSession("a", { cwd: "/repo/feature" }) },
      { a: terminalStatus("working", { id: "a" }) },
      {},
    );
    expect(glance.severity).toBe("working");
    expect(glance.allDead).toBe(false);
    expect(glance.title).toBe("feature");
    expect(glance.primaryId).toBe("a");
  });

  it("marks a tab dead only when every pane has exited", () => {
    const tab = makeTab("tab1", "a");
    const glance = tabGlance(tab, {}, {}, { a: 0 });
    expect(glance.allDead).toBe(true);
    // With no statuses at all, the focused pane still names the summary target.
    expect(glance.primaryId).toBe("a");
  });
});

describe("tailLines", () => {
  it("keeps the last n lines and trims trailing whitespace", () => {
    expect(tailLines("a\nb\nc\nd  \n\n\n", 2)).toBe("c\nd");
  });

  it("returns short text unchanged", () => {
    expect(tailLines("only", 10)).toBe("only");
  });
});

describe("needsYouQueue", () => {
  function state(
    statuses: TerminalStatus[],
    exited: Record<string, number | null> = {},
  ) {
    const terminalSessions: Record<string, TerminalSessionInfo> = {};
    const terminalStatuses: Record<string, TerminalStatus> = {};
    for (const st of statuses) {
      terminalSessions[st.id] = terminalSession(st.id);
      terminalStatuses[st.id] = st;
    }
    return { terminalSessions, terminalStatuses, terminalExited: exited };
  }

  it("orders attention before prompts, oldest ask first", () => {
    const queue = needsYouQueue(
      state([
        terminalStatus("waiting_for_input", {
          id: "prompt",
          enteredStateAt: 1,
        }),
        terminalStatus("needs_attention", { id: "late", enteredStateAt: 300 }),
        terminalStatus("working", { id: "busy" }),
        terminalStatus("needs_attention", { id: "early", enteredStateAt: 100 }),
      ]),
    );
    expect(queue).toEqual(["early", "late", "prompt"]);
  });

  it("skips exited sessions and idle shells", () => {
    const queue = needsYouQueue(
      state(
        [
          terminalStatus("needs_attention", { id: "dead" }),
          terminalStatus("idle", { id: "quiet" }),
        ],
        { dead: 0 },
      ),
    );
    expect(queue).toEqual([]);
  });

  it("hasNeedsYou agrees with the queue it summarizes", () => {
    const asking = state([terminalStatus("needs_attention", { id: "a" })]);
    const quiet = state([terminalStatus("idle", { id: "a" })]);
    expect(hasNeedsYou(asking)).toBe(true);
    expect(hasNeedsYou(quiet)).toBe(false);
  });
});

describe("overviewGroups", () => {
  it("sorts loudest group first and loudest card within a group", () => {
    const groups = overviewGroups(
      { "/repo:quiet": ["idle1"], "/repo:hot": ["busy", "asking"] },
      {
        idle1: terminalSession("idle1"),
        busy: terminalSession("busy"),
        asking: terminalSession("asking"),
      },
      {
        idle1: terminalStatus("idle", { id: "idle1" }),
        busy: terminalStatus("working", { id: "busy" }),
        asking: terminalStatus("needs_attention", { id: "asking" }),
      },
      {},
    );
    expect(groups.map((g) => g.key)).toEqual(["/repo:hot", "/repo:quiet"]);
    expect(groups[0].ids).toEqual(["asking", "busy"]);
    expect(groups[0].label).toBe("repo · hot");
  });

  it("sinks exited sessions and ignores them when ranking the group", () => {
    const groups = overviewGroups(
      { "/repo:main": ["gone", "quiet"] },
      { gone: terminalSession("gone"), quiet: terminalSession("quiet") },
      {
        gone: terminalStatus("needs_attention", { id: "gone" }),
        quiet: terminalStatus("idle", { id: "quiet" }),
      },
      { gone: 0 },
    );
    expect(groups[0].ids).toEqual(["quiet", "gone"]);
    expect(groups[0].severity).toBe("idle");
  });
});
