import { type ReactNode, memo, useEffect, useState } from "react";
import { useReviewStore } from "../../stores";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useAutoUpdater } from "../../hooks/useAutoUpdater";
import { getPlatformServices } from "../../platform";
import { focusWorkspace } from "../../commands/workspaceCommands";
import { SidebarPanelIcon, XIcon } from "../ui/icons";
import { SidebarResizeHandle } from "../ui/sidebar-resize-handle";
import { Spinner } from "../ui/spinner";
import { LspStatusIndicator } from "../LspStatusIndicator";
import { AgentUsageIndicator } from "../AgentUsageIndicator";
import { SidebarRail } from "./SidebarRail";
import { PullRequestsDrawer } from "./PullRequestsDrawer";
import { WorkspaceQueue } from "./WorkspaceQueue";

const GITHUB_REPO_URL = "https://github.com/dropseed/review";

interface FooterVersionInfoProps {
  updateAvailable: { version: string } | null;
  installing: boolean;
  installUpdate: () => void;
  appVersion: string | null;
  onOpenRelease: () => void;
}

/** Displays either an update button or the current version in the footer. */
function FooterVersionInfo({
  updateAvailable,
  installing,
  installUpdate,
  appVersion,
  onOpenRelease,
}: FooterVersionInfoProps): ReactNode {
  if (updateAvailable) {
    return (
      <button
        type="button"
        onClick={installUpdate}
        disabled={installing}
        className="flex items-center gap-1.5 text-[10px] font-medium text-status-approved hover:text-status-approved transition-colors duration-100 disabled:opacity-50"
      >
        {installing ? (
          <>
            <Spinner className="h-2.5 w-2.5 border-[1.5px] border-edge-strong border-t-status-approved" />
            Installing…
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-status-approved" />
            Update to v{updateAvailable.version}
          </>
        )}
      </button>
    );
  }

  if (appVersion) {
    return (
      <button
        type="button"
        onClick={onOpenRelease}
        className="text-[10px] tabular-nums text-fg-faint hover:text-fg-muted transition-colors duration-100"
      >
        v{appVersion}
      </button>
    );
  }

  return null;
}

/**
 * The sidebar's own header: what the queue is, create a workspace, and put
 * the sidebar away.
 *
 * "Working on" names the whole list, not a section of it — it also anchors
 * the row so the two buttons aren't floating alone against the right edge.
 *
 * `+` makes the workspace on the spot — no picker, no title prompt. An empty
 * workspace is a legible thing now: it lands on the stage showing its own two
 * verbs, and it names itself after whatever you put in it first.
 *
 * The columns button beside it is the queue read the other way round: instead
 * of one workspace at a time, every terminal in every one of them at once. It
 * belongs here because the row it opens spans the whole list this header names.
 *
 * The gear is settings, and it is here because the sidebar is the one piece of
 * chrome a thumb can reach: ⌘, was the whole of the app's answer, and the
 * drawer this component becomes at compact width had no way in at all.
 */
function SidebarHeader({
  onToggle,
  drawer = false,
}: {
  onToggle: () => void;
  drawer?: boolean;
}): ReactNode {
  const addWorkspace = useReviewStore((s) => s.addWorkspace);
  const openOverlay = useReviewStore((s) => s.openOverlay);
  const terminalOverview = useReviewStore((s) => s.terminalOverview);
  const toggleTerminalOverview = useReviewStore(
    (s) => s.toggleTerminalOverview,
  );
  // Same gate the terminal's own commands use: with no daemon to talk to there
  // are no terminals to line up, and the button would open a view whose only
  // possible answer is "nothing is running".
  const terminalsSupported = useReviewStore((s) => s.terminalsSupported);

  async function create(): Promise<void> {
    const workspace = await addWorkspace(null, []);
    if (workspace) focusWorkspace(workspace);
  }

  return (
    <div className="shrink-0 pl-3 pr-2 py-2 flex items-center justify-between gap-1">
      <span className="min-w-0 truncate text-[11px] font-medium leading-4 text-fg-muted">
        Working on
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {terminalsSupported && (
          <button
            type="button"
            onClick={toggleTerminalOverview}
            aria-pressed={terminalOverview}
            className={`flex items-center justify-center w-6 h-6 rounded
                   hover:bg-surface-raised transition-colors ${
                     terminalOverview
                       ? "bg-surface-raised text-fg-secondary"
                       : "text-fg-muted hover:text-fg-secondary"
                   }`}
            aria-label="All terminals"
            title="All terminals"
          >
            {/* Columns: the shape of what it opens — every terminal side by
              side, in a row you scroll. */}
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="5" height="16" rx="1" />
              <rect x="10" y="4" width="5" height="16" rx="1" />
              <rect x="17" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => void create()}
          className="flex items-center justify-center w-6 h-6 rounded
                   text-fg-muted hover:text-fg-secondary hover:bg-surface-raised
                   transition-colors"
          aria-label="New workspace"
          title="New workspace"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => openOverlay("settings")}
          className="flex items-center justify-center w-6 h-6 rounded
                   text-fg-muted hover:text-fg-secondary hover:bg-surface-raised
                   transition-colors"
          aria-label="Settings"
          title="Settings"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center justify-center w-6 h-6 shrink-0 rounded
                   hover:bg-fg/[0.08] transition-colors duration-100
                   text-fg-muted hover:text-fg-secondary"
          aria-label={drawer ? "Close" : "Hide sidebar"}
        >
          {drawer ? (
            <XIcon className="w-3.5 h-3.5" />
          ) : (
            <SidebarPanelIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </span>
    </div>
  );
}

/**
 * The sidebar: the app's chrome, and the whole of its navigation.
 *
 * It holds the workspace queue, the pull-requests drawer under it, and the
 * app-level bits at the foot (agent usage, LSP, version). The drawer is the one
 * list here that isn't the queue, and it earns that by answering a different
 * question — what is out on GitHub that the queue *hasn't* picked up — and by
 * subtracting everything the queue already shows. No repo list: repos and branches are
 * reached through ⌘K, which searches the same tree the list used to draw, and a
 * repo you are actually working in is a workspace in the queue by definition.
 * Nothing here is a second place to look.
 */
export const Sidebar = memo(function Sidebar({
  drawer = false,
  onDismiss,
}: {
  /**
   * Drawn as a phone drawer rather than the window's own column: it fills
   * whatever width the drawer gives it, its resize handle and collapsed rail
   * are gone (there is nothing beside it to take room from), and the header's
   * button dismisses the drawer instead of collapsing a column.
   */
  drawer?: boolean;
  onDismiss?: () => void;
} = {}) {
  const storeCollapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleStoreSidebar = useReviewStore((s) => s.toggleTabRail);
  // A drawer is only ever rendered while open, and its own state is the shell's
  // — the persisted desktop collapse must not decide whether a phone's queue
  // appears, or a window collapsed on a laptop would open to an empty drawer.
  const collapsed = drawer ? false : storeCollapsed;
  const toggleSidebar = drawer ? (onDismiss ?? (() => {})) : toggleStoreSidebar;

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const { updateAvailable, installing, installUpdate } = useAutoUpdater();

  const { sidebarWidth, isResizing, handleResizeStart } = useSidebarResize({
    sidebarPosition: "left",
    initialWidth: 15,
    minWidth: 10,
    maxWidth: 24,
  });

  useEffect(() => {
    getPlatformServices()
      .window.getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  function handleOpenRelease(): void {
    getPlatformServices().opener.openUrl(
      `${GITHUB_REPO_URL}/releases/tag/v${appVersion}`,
    );
  }

  return (
    <div className={drawer ? "flex h-full min-h-0" : "relative flex shrink-0"}>
      {/* Collapsed, the sidebar keeps its column as a rail rather than
          vanishing — the way back lives on the sidebar's own edge instead of
          floating over whichever view is mounted. The nav below stays mounted
          at zero width so expanding is a width animation, not a remount. */}
      {collapsed && !drawer && <SidebarRail onExpand={toggleSidebar} />}

      {/* select-none for the whole sidebar: entries are things you click and
          drag, not text you select. */}
      <nav
        className={`tab-rail flex h-full shrink-0 select-none flex-col
                   bg-surface overflow-hidden
                   ${drawer ? "w-full" : ""}
                   ${isResizing || drawer ? "" : "transition-[width,opacity] duration-200 ease-out"}`}
        style={
          drawer
            ? undefined
            : {
                width: collapsed ? 0 : `${sidebarWidth}rem`,
                opacity: collapsed ? 0 : 1,
              }
        }
        aria-label="Workspaces"
        aria-hidden={collapsed}
      >
        <div
          className="flex flex-col h-full min-w-0"
          style={drawer ? { width: "100%" } : { width: `${sidebarWidth}rem` }}
        >
          <SidebarHeader onToggle={toggleSidebar} drawer={drawer} />

          <WorkspaceQueue />

          <PullRequestsDrawer />

          <AgentUsageIndicator />

          <div className="shrink-0 px-3 py-3 border-t border-t-edge/40">
            <div className="flex items-center justify-between">
              <LspStatusIndicator />
              <FooterVersionInfo
                updateAvailable={updateAvailable}
                installing={installing}
                installUpdate={installUpdate}
                appVersion={appVersion}
                onOpenRelease={handleOpenRelease}
              />
            </div>
          </div>
        </div>

        {!collapsed && !drawer && (
          <SidebarResizeHandle
            position="right"
            onMouseDown={handleResizeStart}
          />
        )}
      </nav>
    </div>
  );
});
