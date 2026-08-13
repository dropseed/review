/**
 * What the "Unclaimed terminals" band shows, as ordered row descriptors.
 *
 * The band used to carry three kinds of row — shells, branches with edits,
 * blocked PRs — and re-derived membership for the last two from state the tree
 * had already answered. Those two facts are on the tree's own rows now (the
 * `M` badge, the PR glyph) and on the work cards that cover them, so the band
 * is left with the one thing no row below can show: a terminal that is running
 * with no work item and no branch row to hang it off.
 *
 * One row per *tab*, like every other terminal entry outside the panel. Nothing
 * here is dismissible, and there is nothing to dismiss: a running shell is a
 * fact, and hiding one would hide the only place its output is reachable from.
 * Membership is `useUnattachedTabIds` — attach the tab to a work item and the
 * row leaves on its own.
 *
 * Kept JSX-free so the naming rule is unit-testable.
 */

import type { TerminalSessionInfo } from "../../types";
import type { TerminalTab } from "../Terminal/pane-tree";
import { repoLabel, type WorkContext } from "./work-status";

export interface TerminalBandRow {
  key: string;
  tabId: string;
  /** The repo it is running in, or `shell` when the session isn't known yet. */
  repoName: string;
}

export interface TerminalBandInput {
  /** Tabs no work item accounts for, in the order the band lists them. */
  tabIds: string[];
  tabs: TerminalTab[];
  sessions: Record<string, TerminalSessionInfo>;
}

/**
 * The band's rows, in strip order.
 *
 * A tab is attributed to the repo of its focused pane — the pane whose title
 * the row is showing, so the name and the place agree. Attribution goes through
 * `repoLabel` rather than the session's own path basename, so a terminal and
 * the repo row it is sitting in are called the same thing.
 */
export function terminalBandRows(
  ctx: WorkContext,
  input: TerminalBandInput,
): TerminalBandRow[] {
  const byId = new Map(input.tabs.map((tab) => [tab.id, tab]));
  return input.tabIds.map((tabId) => {
    const tab = byId.get(tabId);
    const session = tab ? input.sessions[tab.focused] : undefined;
    return {
      key: `t:${tabId}`,
      tabId,
      repoName: session ? repoLabel(ctx, session.repoPath) : "shell",
    };
  });
}
