import { describe, expect, it } from "vitest";
import { agentKind } from "./agent-kind";

describe("agentKind", () => {
  it("names the agent a shell is running", () => {
    expect(agentKind("claude")).toBe("claude");
    expect(agentKind("codex")).toBe("codex");
  });

  it("sees through a path or a wrapper", () => {
    expect(agentKind("/opt/homebrew/bin/claude")).toBe("claude");
    expect(agentKind("npx claude")).toBe("claude");
    expect(agentKind("arch -x86_64 codex")).toBe("codex");
    expect(agentKind("env FOO=1 claude --resume")).toBe("claude");
  });

  /** The whole point of matching the command rather than the line. */
  it("does not read an agent's name out of an argument", () => {
    expect(agentKind('git commit -m "fix the codex thing"')).toBeNull();
    expect(agentKind("vim claude.md")).toBeNull();
    expect(agentKind("cd ~/claude-experiments")).toBeNull();
    expect(agentKind("rg claude")).toBeNull();
  });

  it("has no opinion about an idle or unknown shell", () => {
    expect(agentKind(null)).toBeNull();
    expect(agentKind("")).toBeNull();
    expect(agentKind("   ")).toBeNull();
    expect(agentKind("zsh")).toBeNull();
  });

  it("is case-insensitive about the command's own name", () => {
    expect(agentKind("Claude")).toBe("claude");
  });
});
