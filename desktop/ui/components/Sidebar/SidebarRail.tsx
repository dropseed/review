import { type ReactNode } from "react";
import { clsx } from "clsx";
import {
  useFocusedWorkspace,
  useWorkspaces,
} from "../../stores/selectors/workspaces";
import {
  useTerminalsByWorkspaceId,
  workspaceTerminals,
} from "../../stores/selectors/terminals";
import { focusWorkspace } from "../../commands/workspaceCommands";
import { Rail, RailButton, RailSeparator, railTooltipSide } from "../ui/rail";
import { SidebarPanelIcon } from "../ui/icons";
import { SimpleTooltip } from "../ui/tooltip";
import { AgentUsageRail } from "../AgentUsageIndicator";
import { StatusDot, STATE_LABEL, workspaceState } from "./StatusDot";
import type { Workspace } from "../../types";

/**
 * The sidebar's collapsed state — the same rule the terminal panel follows:
 * hiding a pane leaves a strip on its edge, not nothing. Collapsing used to
 * drop the sidebar to zero width and float a lone toggle over the content,
 * which read as a stray button in dead space.
 *
 * What it carries is what survives losing the labels: the queue, as the numbers
 * it already answers to (⌘1–9 and the position of each entry), each wearing its
 * own state. Nothing that wants you is more than one click away — which is what
 * collapsed has to keep being, or it is just a button that undoes itself.
 */
export function SidebarRail({ onExpand }: { onExpand: () => void }): ReactNode {
  const workspaces = useWorkspaces();
  const terminals = useTerminalsByWorkspaceId();
  const focused = useFocusedWorkspace();

  return (
    <Rail className="w-9 shrink-0 border-r border-edge bg-surface">
      <RailButton label="Show sidebar (⌘B)" edge="left" onClick={onExpand}>
        <SidebarPanelIcon className="h-3.5 w-3.5" />
      </RailButton>

      {workspaces.length > 0 && <RailSeparator />}

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
        {workspaces.map((workspace, index) => {
          const own = workspaceTerminals(terminals, workspace.id);
          return (
            <WorkspaceRailTab
              key={workspace.id}
              workspace={workspace}
              index={index}
              state={workspaceState(own.phase, own.tabs > 0)}
              active={workspace.id === focused?.id}
            />
          );
        })}
      </div>

      {/* Where the usage rows sit when the sidebar is open — kept at the foot
          rather than dropped, since how much of the week is left is exactly
          the kind of thing you want without expanding anything. */}
      <AgentUsageRail edge="left" />
    </Rail>
  );
}

/**
 * One workspace, as its position number.
 *
 * The number is the workspace's whole identity here, and it is the same number
 * ⌘N presses — a rotated title would be a second name for a thing that already
 * has a short one. The dot beside it is what the card would wear, so the strip
 * still says which workspace wants a human.
 */
function WorkspaceRailTab({
  workspace,
  index,
  state,
  active,
}: {
  workspace: Workspace;
  index: number;
  state: ReturnType<typeof workspaceState>;
  active: boolean;
}): ReactNode {
  // Just the name: the rail has room for a number and a dot, so joining the
  // whole status against the sidebar tree would be work nothing reads.
  const label = `${index + 1}. ${workspace.displayTitle} — ${STATE_LABEL[state]}`;

  return (
    <SimpleTooltip content={label} side={railTooltipSide("left")}>
      <button
        type="button"
        onClick={() => focusWorkspace(workspace)}
        aria-label={label}
        aria-current={active ? "true" : undefined}
        className={clsx(
          "relative flex h-6 w-6 shrink-0 items-center justify-center rounded",
          "text-[11px] tabular-nums text-fg-muted transition-colors duration-100",
          active ? "bg-surface-raised" : "hover:bg-fg/[0.08]",
        )}
      >
        {index + 1}
        <StatusDot
          state={state}
          className="absolute -right-px -top-px size-[5px]"
        />
      </button>
    </SimpleTooltip>
  );
}
