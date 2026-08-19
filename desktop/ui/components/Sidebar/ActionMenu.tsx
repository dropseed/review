import { type ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useWorkspaces } from "../../stores/selectors/workspaces";
import {
  findTabForTerminal,
  tabWorkspaceId,
} from "../../stores/slices/terminalSlice";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "../ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/dropdown-menu";
import { terminalActions, type WorkAction } from "./workspace-actions";

/**
 * The renderers for `work-actions`.
 *
 * Three of them because the sidebar opens menus three ways — right-click, an
 * overflow dropdown, and the hand-rolled portal the branch rows still use — and
 * one of them because what each renders is the same `WorkAction[]`. A verb
 * added to a noun appears in whichever channels that noun offers, without
 * anyone deciding again what it means.
 */

const DANGER_CLASS = "text-status-rejected/90 focus:text-status-rejected";

/** Verbs as right-click menu items, submenus included. */
export function ContextActionItems({
  actions,
}: {
  actions: WorkAction[];
}): ReactNode {
  return (
    <>
      {actions.map((action) =>
        action.items ? (
          <ContextMenuSub key={action.id}>
            <ContextMenuSubTrigger
              disabled={action.disabled}
              className="px-3 py-1.5 text-xs"
            >
              {action.label}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextActionItems actions={action.items} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem
            key={action.id}
            disabled={action.disabled}
            onSelect={action.run}
            className={action.danger ? DANGER_CLASS : undefined}
          >
            {action.label}
          </ContextMenuItem>
        ),
      )}
    </>
  );
}

/** The same verbs, for a noun whose menu hangs off an overflow button. */
export function DropdownActionItems({
  actions,
}: {
  actions: WorkAction[];
}): ReactNode {
  return (
    <>
      {actions.map((action) =>
        action.items ? (
          <DropdownMenuSub key={action.id}>
            <DropdownMenuSubTrigger disabled={action.disabled}>
              {action.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownActionItems actions={action.items} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            key={action.id}
            disabled={action.disabled}
            onSelect={action.run}
            className={action.danger ? DANGER_CLASS : undefined}
          >
            {action.label}
          </DropdownMenuItem>
        ),
      )}
    </>
  );
}

/**
 * The terminal menu, wherever a terminal is shown.
 *
 * One component rather than one call per surface: the card's child row, the
 * strip tab and the pane each know which sessions they stand for and nothing
 * else, and everything the menu needs beyond that — which workspace they are
 * in, what workspaces exist — is read here. That is what makes the three menus
 * the same menu instead of three that agree today.
 *
 * The sessions are always one tab's, and a tab is in exactly one workspace, so
 * "where is this" is a question about the tab rather than about whichever pane
 * the caller happened to list first.
 */
export function useTerminalActions(sessionIds: string[]): WorkAction[] {
  const workspaces = useWorkspaces();
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const terminalSessions = useReviewStore((s) => s.terminalSessions);
  const tab = findTabForTerminal(terminalTabs, sessionIds[0]);
  const attachedItemId = tab ? tabWorkspaceId({ terminalSessions }, tab) : null;

  return terminalActions({ sessionIds, attachedItemId, workspaces });
}

/** The terminal menu as right-click items. */
export function TerminalMenuItems({
  sessionIds,
}: {
  sessionIds: string[];
}): ReactNode {
  return <ContextActionItems actions={useTerminalActions(sessionIds)} />;
}
