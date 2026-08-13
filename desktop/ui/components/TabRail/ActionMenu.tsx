import { type ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { useWorkItems } from "../../stores/selectors/work";
import {
  findTabForTerminal,
  tabItemId,
} from "../../stores/slices/terminalSlice";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/dropdown-menu";
import { terminalActions, type WorkAction } from "./work-actions";

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

const BUTTON_CLASS =
  "w-full px-3 py-1.5 text-left text-xs text-fg-secondary transition-colors " +
  "hover:bg-fg/[0.08] disabled:opacity-40";

/**
 * The same verbs as plain buttons, for the branch and review rows — their menus
 * are portals of their own, opened next to the pointer, because they also hold
 * the nested "Change Base…" panel that isn't a verb at all.
 *
 * Flat only: nothing rendered here has a submenu, and a submenu in a portal
 * with no floating layer would have nowhere to go.
 */
export function ButtonActionItems({
  actions,
  onDone,
}: {
  actions: WorkAction[];
  onDone: () => void;
}): ReactNode {
  return (
    <>
      {actions
        .filter((action) => !action.items)
        .map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={action.disabled}
            onClick={() => {
              action.run?.();
              onDone();
            }}
            className={clsx(BUTTON_CLASS, action.danger && DANGER_CLASS)}
          >
            {action.label}
          </button>
        ))}
    </>
  );
}

/**
 * The terminal menu, wherever a terminal is shown.
 *
 * One component rather than one call per surface: the band row, the card's
 * child row, the strip tab and the pane each know which sessions they stand
 * for and nothing else, and everything the menu needs beyond that — what they
 * are attached to, what items exist — is read here. That is what makes the four
 * menus the same menu instead of four that agree today.
 *
 * The sessions are always one tab's, and a tab has exactly one attachment, so
 * "what is this attached to" is a question about the tab rather than about
 * whichever pane the caller happened to list first.
 */
export function useTerminalActions(sessionIds: string[]): WorkAction[] {
  const items = useWorkItems();
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const terminalAttachments = useReviewStore((s) => s.terminalAttachments);
  const tab = findTabForTerminal(terminalTabs, sessionIds[0]);
  const attachedItemId = tab ? tabItemId(terminalAttachments, tab.id) : null;

  return terminalActions({ sessionIds, attachedItemId, items });
}

/** The terminal menu as right-click items. */
export function TerminalMenuItems({
  sessionIds,
}: {
  sessionIds: string[];
}): ReactNode {
  return <ContextActionItems actions={useTerminalActions(sessionIds)} />;
}

/**
 * The same menu opened by a button instead.
 *
 * The terminal pane needs this one: right-click belongs to the shell there —
 * a TUI with mouse reporting on is *sent* that button — so the pane's menu
 * hangs off an affordance in its chrome rather than off the VT surface. Same
 * hook, so it is the same menu either way.
 */
export function TerminalDropdownItems({
  sessionIds,
}: {
  sessionIds: string[];
}): ReactNode {
  return <DropdownActionItems actions={useTerminalActions(sessionIds)} />;
}

/**
 * Verbs on a right-click menu around `children`, for the nouns whose element
 * has nothing else wrapped around it.
 *
 * `asChild`, so the trigger stays the caller's own element — these rows are
 * draggable, and a wrapper between them and the pointer is where a drag stops
 * starting. A noun that already sits inside another Radix root (the terminal
 * row, which is also a hover-card trigger) composes the parts itself.
 *
 * A noun with no verbs — an uncloned repo whose PRs carry no URL — keeps its
 * element and gets no menu at all, rather than an empty panel that opens.
 */
export function ActionContextMenu({
  actions,
  children,
}: {
  actions: WorkAction[];
  children: ReactNode;
}): ReactNode {
  if (actions.length === 0) return children;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextActionItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
