import { useCallback, useMemo } from "react";
import { useSpurStore } from "../../../stores";
import { useWorkspaces } from "../../../stores/selectors/workspaces";
import { useSidebarTree } from "../../../hooks/useSidebarTree";
import {
  useTerminalsByWorkspaceId,
  workspaceTerminals,
  type WorkspaceTerminals,
} from "../../../stores/selectors/terminals";
import { allSidebarRows, type SidebarRow } from "../../../utils/sidebar-tree";
import { tabGlance } from "../../Terminal/glance";
import { jumpToTab } from "../../Terminal/jump";
import { openTerminalTab } from "../../Terminal/newTab";
import {
  focusWorkspace,
  openRowInWorkspace,
} from "../../../commands/workspaceCommands";
import {
  scoreCandidate,
  indicesFor,
  HighlightedText,
} from "../../../lib/fuzzy";
import { repoDisplayName } from "../../../utils/repo-identity";
import { StatusDot, workspaceState } from "../../Sidebar/StatusDot";
import { routePreviewLabel } from "../route-preview";
import {
  previewRouteIn,
  repoHosts,
} from "../../../stores/selectors/workspaceData";
import { describeWorkspace } from "../../Sidebar/workspace-status";
import { useWorkspaceContext } from "../../Sidebar/workspace-context";
import {
  countLabel,
  type PaletteGroup,
  type PaletteSource,
} from "../PaletteDialog";
import type { Workspace } from "../../../types";

/**
 * ⌘K: the one place you go somewhere.
 *
 * Three kinds of destination, and only three — a workspace, a repo's branch, a
 * running terminal — because those are the three things the app has. There is
 * no fourth list anywhere else in the window, which is the point of the sidebar
 * having lost its repo tree: the tree is still built, and this is where you
 * read it.
 *
 * The router preview on a branch row ("→ joins reserved tunnels" / "→ new
 * workspace") is what makes opening one predictable: the whole decision is a
 * lookup over the attachments already in the store, so it costs nothing per
 * keystroke and cannot disagree with what pressing Enter does. That is why the
 * rule lives in `previewRouteIn` rather than here — this file used to re-roll
 * it, and the copy drifted.
 */

const TITLE_WEIGHT = 1;
const DETAIL_WEIGHT = 0.5;

/**
 * How many branch and terminal rows the list draws, as `files` (50) and
 * `symbols` (200) also cap themselves.
 *
 * The empty query is what makes this necessary: with no query every branch of
 * every registered repo matches, so the list was every row the tree knows,
 * unvirtualized, re-rendered per keystroke. Nobody reads past the first screen
 * of an unfiltered list — they type — and typing is exactly what the uncapped
 * render was making slow.
 *
 * Workspaces are exempt: the queue is short by construction, and it is the one
 * group whose *absence* would be read as "that workspace is gone".
 */
const MAX_RESULTS = 50;

type Entry =
  | {
      kind: "workspace";
      id: string;
      title: string;
      detail: string;
      workspace: Workspace;
    }
  | {
      kind: "branch";
      id: string;
      title: string;
      detail: string;
      row: SidebarRow;
      preview: string;
    }
  | {
      kind: "terminal";
      id: string;
      title: string;
      detail: string;
      tabId: string;
    };

interface Scored {
  entry: Entry;
  titleIndices: number[];
}

const NO_GROUPS: PaletteGroup<Scored>[] = [];

const GROUP_LABEL: Record<Entry["kind"], string> = {
  workspace: "Workspaces",
  branch: "Branches",
  terminal: "Terminals",
};

const GROUP_ORDER: Entry["kind"][] = ["workspace", "branch", "terminal"];

export function useGoSource(
  query: string,
  active: boolean,
): PaletteSource<Scored> {
  const closeOverlay = useSpurStore((s) => s.closeOverlay);
  const workspaces = useWorkspaces();
  const ctx = useWorkspaceContext();
  const tree = useSidebarTree();
  const repoMetadata = useSpurStore((s) => s.repoMetadata);
  const terminals = useTerminalsByWorkspaceId();
  const terminalTabs = useSpurStore((s) => s.terminalTabs);
  const sessions = useSpurStore((s) => s.terminalSessions);
  const statuses = useSpurStore((s) => s.terminalStatuses);
  const exited = useSpurStore((s) => s.terminalExited);

  // Two memos, not one: a status tick changes the terminals and nothing else,
  // and rebuilding the branch list on it would re-walk the sidebar tree and
  // re-resolve every row's route preview several times a minute.
  const destinations = useMemo((): Entry[] => {
    if (!active) return [];

    const out: Entry[] = workspaces.map((workspace): Entry => {
      // The same description the queue shows — "repo · branch, 3/10 reviewed" —
      // rather than the attachments' raw absolute paths, which is what a
      // palette row is least able to read.
      const status = describeWorkspace(workspace, ctx);
      // What a nested workspace sits under. The sidebar carries that in the
      // indent and this list has no indent to carry it — and the palette is
      // where a subtask is most likely to be looked for by the name of the
      // thing it belongs to. In `detail` rather than the title so it is also
      // *searchable*: typing a parent's name brings its children up with it.
      const under = workspace.ancestors.map((a) => a.displayTitle).join(" › ");
      return {
        kind: "workspace",
        id: `workspace:${workspace.id}`,
        title: workspace.displayTitle,
        detail: [under && `in ${under}`, status.subtitle]
          .filter(Boolean)
          .join(" · "),
        workspace,
      };
    });

    // One pass over the attachments, then a lookup per row — the naive form was
    // a scan over every workspace's every repo for every branch in every repo.
    // The *rule* is `previewRouteIn`'s either way; this only supplies its index.
    const hosts = repoHosts(workspaces);

    for (const node of tree) {
      const repoName = repoDisplayName(
        repoMetadata[node.repoPath]?.routePrefix,
        node.repoName,
      );
      for (const row of allSidebarRows([node])) {
        out.push({
          kind: "branch",
          id: `branch:${row.reviewKey}`,
          title: row.ref,
          detail: repoName,
          row,
          preview: routePreviewLabel(previewRouteIn(hosts, row.repoPath)),
        });
      }
    }
    return out;
  }, [active, workspaces, ctx, tree, repoMetadata]);

  const terminalEntries = useMemo((): Entry[] => {
    if (!active) return [];
    return terminalTabs.map((tab) => ({
      kind: "terminal",
      id: `terminal:${tab.id}`,
      title: tabGlance(tab, sessions, statuses, exited).title,
      detail: sessions[tab.focused]?.cwd ?? "",
      tabId: tab.id,
    }));
  }, [active, terminalTabs, sessions, statuses, exited]);

  const entries = useMemo(
    () => [...destinations, ...terminalEntries],
    [destinations, terminalEntries],
  );

  const trimmed = query.trim();

  const groups = useMemo((): PaletteGroup<Scored>[] => {
    if (!active) return NO_GROUPS;

    const matched: { scored: Scored; score: number }[] = [];
    for (const entry of entries) {
      if (!trimmed) {
        matched.push({ scored: { entry, titleIndices: [] }, score: 0 });
        continue;
      }
      const result = scoreCandidate(trimmed, [
        { key: "title", text: entry.title, weight: TITLE_WEIGHT },
        { key: "detail", text: entry.detail, weight: DETAIL_WEIGHT },
      ]);
      if (!result) continue;
      matched.push({
        score: result.score,
        scored: { entry, titleIndices: indicesFor(result, "title") },
      });
    }

    if (trimmed) matched.sort((a, b) => b.score - a.score);

    // Capped after scoring, so what survives is the best of the list rather
    // than the first N of it. Workspaces are counted separately and never cut.
    const workspaceRows = matched.filter(
      (m) => m.scored.entry.kind === "workspace",
    );
    const rest = matched
      .filter((m) => m.scored.entry.kind !== "workspace")
      .slice(0, MAX_RESULTS);
    const shown = [...workspaceRows, ...rest];

    // Grouped even while searching: the three kinds answer different questions,
    // and a flat ranked list makes a branch and a workspace of the same name
    // impossible to tell apart at a glance.
    return GROUP_ORDER.flatMap((kind) => {
      const items = shown
        .filter((m) => m.scored.entry.kind === kind)
        .map((m) => m.scored);
      return items.length === 0
        ? []
        : [
            {
              key: kind,
              header: <GroupHeader label={GROUP_LABEL[kind]} />,
              items,
            },
          ];
    });
  }, [active, entries, trimmed]);

  /**
   * Go there — and, with `withTerminal`, start a shell there in the same
   * gesture.
   *
   * One function for both verbs on purpose: ⌘Enter has to land in exactly the
   * place Enter would, including the routing decision the row's preview
   * promised, or the two would be different destinations wearing one label.
   */
  const goTo = useCallback(
    ({ entry }: Scored, withTerminal: boolean) => {
      closeOverlay("palette");
      if (entry.kind === "workspace") {
        focusWorkspace(entry.workspace);
        if (withTerminal) void openTerminalTab(entry.workspace);
        return;
      }
      if (entry.kind === "terminal") {
        // A running shell is already where it is: the second verb has nothing
        // to add, so it does what Enter does rather than starting a rival.
        jumpToTab(entry.tabId);
        return;
      }
      // A branch *lands* before anything is shown. The row promised a
      // workspace — "joins reserved tunnels", "new workspace" — and the only
      // way to keep that promise is to commit the same routing decision the
      // preview mirrored, then focus what it returned. Opening the comparison
      // alone would leave the promised workspace uncreated.
      void openRowInWorkspace(entry.row, { withTerminal });
    },
    [closeOverlay],
  );

  const onActivate = useCallback(
    (scored: Scored) => goTo(scored, false),
    [goTo],
  );
  const onAlternateActivate = useCallback(
    (scored: Scored) => goTo(scored, true),
    [goTo],
  );

  return {
    title: "Go to",
    placeholder: "Go to a workspace, branch, or terminal…",
    groups,
    getKey: (scored) => scored.entry.id,
    renderRow: (scored) => <GoRow scored={scored} terminals={terminals} />,
    onActivate,
    onAlternateActivate,
    emptyMessage: "Nothing matches",
    enterLabel: "open",
    alternateLabel: "open + terminal",
    renderCount: (n) => countLabel(n, "result"),
  };
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div
      data-palette-header
      className="sticky top-0 border-b border-edge bg-surface-panel px-4 py-1 text-xxs uppercase tracking-wide text-fg-faint"
    >
      {label}
    </div>
  );
}

function GoRow({
  scored,
  terminals,
}: {
  scored: Scored;
  terminals: Record<string, WorkspaceTerminals>;
}) {
  const { entry, titleIndices } = scored;
  const own = workspaceTerminals(
    terminals,
    entry.kind === "workspace" ? entry.workspace.id : null,
  );

  return (
    <div className="flex items-center gap-2.5 px-4 py-2 text-left">
      {entry.kind === "workspace" && (
        <StatusDot state={workspaceState(own.phase, own.tabs > 0)} />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
        <HighlightedText text={entry.title} indices={titleIndices} />
      </span>
      {entry.detail && (
        <span className="max-w-[40%] shrink-0 truncate text-xs text-fg-faint">
          {entry.detail}
        </span>
      )}
      {entry.kind === "branch" && (
        <span className="shrink-0 text-xs text-fg-muted">{entry.preview}</span>
      )}
    </div>
  );
}
