/** An agent the app can recognise running in a shell. */
export type AgentKind = "claude" | "codex";

/**
 * Which agent — if any — a shell is running, from the command the daemon
 * reports.
 *
 * Read off `runningCommand`, which shell integration already populates for
 * every session, so this costs nothing and needs no new plumbing. It is the
 * same string `terminal-notifications` uses to name what wants attention.
 *
 * Matched on the command's own name rather than anywhere in the line: a shell
 * sitting in `~/claude-experiments`, or running `git commit -m "fix codex
 * thing"`, is not an agent, and a marker that claimed otherwise would be worse
 * than the plain terminal glyph it replaced. A wrapper (`npx claude`, a path,
 * `arch -x86_64 codex`) still resolves, because the last path segment of any
 * argv[0]-ish token is what gets compared.
 */
export function agentKind(runningCommand: string | null): AgentKind | null {
  if (!runningCommand) return null;

  for (const token of runningCommand.trim().split(/\s+/)) {
    // Env assignments and flags precede the real command often enough to be
    // worth stepping over rather than matching against.
    if (token.startsWith("-") || token.includes("=")) continue;
    const name = token.split("/").pop()?.toLowerCase() ?? "";
    if (name === "claude") return "claude";
    if (name === "codex") return "codex";
    // Anything else that isn't a known wrapper is the command, and it isn't an
    // agent — stop rather than reading an agent's name out of its arguments.
    if (!WRAPPERS.has(name)) return null;
  }
  return null;
}

/**
 * Commands that run another command, so the agent's name is further along the
 * line. Deliberately short: every entry is a chance to misread an argument as
 * the thing being run.
 */
const WRAPPERS = new Set([
  "npx",
  "bunx",
  "pnpm",
  "yarn",
  "arch",
  "env",
  "sudo",
]);
