import { describe, it, expect } from "vitest";
import { sessionsUnder } from "./worktree-facts";

describe("sessionsUnder", () => {
  it("matches a session sitting exactly at the worktree path", () => {
    const sessions = { a: { cwd: "/repo/feature" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([sessions.a]);
  });

  it("matches a session nested under the worktree path", () => {
    const sessions = { a: { cwd: "/repo/feature/src" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([sessions.a]);
  });

  it("does not let a sibling with a shared prefix claim the worktree", () => {
    const sessions = { a: { cwd: "/repo/feature-2" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([]);
  });

  it("excludes a session in an unrelated directory", () => {
    const sessions = { a: { cwd: "/repo/other" } };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([]);
  });

  it("returns every matching session, not just the first", () => {
    const sessions = {
      a: { cwd: "/repo/feature" },
      b: { cwd: "/repo/feature/nested" },
      c: { cwd: "/repo/other" },
    };
    expect(sessionsUnder(sessions, "/repo/feature")).toEqual([
      sessions.a,
      sessions.b,
    ]);
  });

  it("returns nothing for an empty session map", () => {
    expect(sessionsUnder({}, "/repo/feature")).toEqual([]);
  });
});
