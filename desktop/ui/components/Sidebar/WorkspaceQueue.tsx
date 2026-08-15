import {
  type ReactNode,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  useFocusedWorkspace,
  useWorkspaces,
} from "../../stores/selectors/workspaces";
import {
  useTabsByWorkspaceId,
  useTerminalsByWorkspaceId,
  workspaceTerminals,
} from "../../stores/selectors/terminals";
import {
  focusWorkspace,
  SHORTCUT_LIMIT,
} from "../../commands/workspaceCommands";
import { useModHeld } from "../../hooks/useModHeld";
import type { Workspace } from "../../types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { CheckIcon } from "../ui/icons";
import { ContextActionItems } from "./ActionMenu";
import { WorkspaceTitleInput } from "./WorkspaceTitleInput";
import { PrBadge } from "./PrBadge";
import { workspaceState } from "./StatusDot";
import { TerminalRow } from "./TerminalRow";
import { activateOnKey } from "./row-chrome";
import { workspaceActions } from "./workspace-actions";
import { useWorkspaceContext } from "./workspace-context";
import {
  attentionSignalAt,
  fileCountLabel,
  describeWorkspace,
  isUnseen,
  type PhraseClause,
  type WorkspaceContext,
  type WorkspaceStatus,
} from "./workspace-status";
import {
  setDraggedWorkspace,
  startWorkspaceDrag,
  useIsWorkDropTarget,
  workSectionDropHandlers,
} from "./workspace-drag";

/**
 * The answer for a workspace running nothing, shared so it is the *same* empty
 * array every time — a fresh `[]` per render would defeat `QueueEntry`'s memo
 * for every dormant card in the queue.
 */
const NO_TABS: string[] = [];

/**
 * The queue: every workspace, in the order the user put them in.
 *
 * The whole of the app's navigation. One list rather than two, because the
 * difference between a workspace you are in and one you have only written down
 * is *derived* — it has terminals or it doesn't — and filing things under a
 * heading you have to maintain is the thing this replaced. Every entry wears
 * its full state: the queue is short and the rail is tall, so the space buys
 * legibility rather than density, and the same drag reorders everything.
 */
export function WorkspaceQueue(): ReactNode {
  const workspaces = useWorkspaces();
  const ctx = useWorkspaceContext();
  const terminals = useTerminalsByWorkspaceId();
  const tabsByWorkspace = useTabsByWorkspaceId();
  const focused = useFocusedWorkspace();
  const modHeld = useModHeld();
  const seenAt = useReviewStore((s) => s.workspaceSeenAt);
  const markWorkspaceSeen = useReviewStore((s) => s.markWorkspaceSeen);

  // Stable, so an entry's acknowledge effect doesn't re-run on every render of
  // the queue.
  const markSeen = useCallback(
    (workspaceId: string) =>
      markWorkspaceSeen(
        workspaceId,
        useReviewStore.getState().workspaces.map((entry) => entry.id),
      ),
    [markWorkspaceSeen],
  );

  const listRef = useRef<HTMLDivElement>(null);

  /**
   * ↑↓ walk the queue and ⏎ opens what they land on.
   *
   * Roving over the rendered entries rather than over an index of our own:
   * the entries are the tab stops, so the browser's own focus is the selection
   * and there is no second highlight to keep in step with it.
   */
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const entries = [
      ...(listRef.current?.querySelectorAll<HTMLElement>(
        "[data-workspace-entry]",
      ) ?? []),
    ];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    // Nothing in the list has focus yet: enter it at whichever end the key
    // points from, so one press always moves.
    const next =
      at === -1
        ? event.key === "ArrowDown"
          ? 0
          : entries.length - 1
        : at + (event.key === "ArrowDown" ? 1 : -1);
    const target = entries[next];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The one drop surface: targets are computed from the cursor position
          (`resolveWorkDropTarget`) against the measured entries, not owned by
          the elements — the gaps and entries below just draw the result. */}
      <div
        ref={listRef}
        data-work-section
        {...workSectionDropHandlers()}
        onKeyDown={handleKeyDown}
        role="listbox"
        aria-label="Workspaces"
        aria-orientation="vertical"
        className="min-h-0 flex-1 space-y-px overflow-y-auto px-1.5 py-1 scrollbar-thin"
      >
        {workspaces.map((workspace, index) => (
          <Fragment key={workspace.id}>
            <DropGap index={index} />
            <QueueEntry
              workspace={workspace}
              index={index}
              count={workspaces.length}
              ctx={ctx}
              terminals={workspaceTerminals(terminals, workspace.id)}
              tabIds={tabsByWorkspace[workspace.id] ?? NO_TABS}
              // Resolved here rather than handing every card the raw key state:
              // a card past the ninth has no digit to reveal, so it must not
              // re-render each time a ⌘ chord is pressed anywhere in the app.
              showShortcut={modHeld && index < SHORTCUT_LIMIT}
              focused={workspace.id === focused?.id}
              seenAt={seenAt[workspace.id]}
              onSeen={markSeen}
            />
          </Fragment>
        ))}
        <DropGap index={workspaces.length} />
        {workspaces.length === 0 && (
          <p className="px-2 py-2 text-[11px] leading-snug text-fg-faint/60">
            Nothing here yet. Press + to start a workspace.
          </p>
        )}
      </div>

      <QueueError />
    </div>
  );
}

/**
 * The last refused mutation, as a line under the queue.
 *
 * Inline rather than a toast: the message is about this list, and it should be
 * read next to the entry that refused it, then be gone by the next gesture.
 */
function QueueError(): ReactNode {
  const error = useReviewStore((s) => s.lastWorkspaceError);
  if (!error) return null;
  return (
    <p className="px-3 pb-1 pt-1 text-[10px] leading-snug text-status-rejected/80">
      {error.message}
    </p>
  );
}

/**
 * The insertion line between two entries, and at the list's own end.
 *
 * Purely an indicator: zero net height, never a pointer target. Which gap is
 * lit is decided by the list's geometry (`resolveWorkDropTarget`), and the line
 * is drawn over the gap rather than by displacing the entries — displacement
 * mid-drag moves the target out from under the cursor.
 */
function DropGap({ index }: { index: number }): ReactNode {
  const isOver = useIsWorkDropTarget(
    useMemo(() => ({ kind: "gap", index }), [index]),
  );

  return (
    <div className="pointer-events-none relative -my-0.5 h-1">
      {isOver && (
        <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 rounded-full bg-focus-ring" />
      )}
    </div>
  );
}

interface QueueEntryProps {
  workspace: Workspace;
  index: number;
  /** How many entries there are — what the move verbs are bounded by. */
  count: number;
  ctx: WorkspaceContext;
  terminals: ReturnType<typeof workspaceTerminals>;
  /**
   * The workspace's terminal tabs, in strip order. Ids rather than the tabs
   * themselves: each row subscribes to its own tab, so a status tick re-renders
   * one line instead of arriving here as a new prop for the whole card.
   */
  tabIds: string[];
  /** ⌘ is down and this card is one a digit can reach — show its number. */
  showShortcut: boolean;
  focused: boolean;
  /** When this workspace was last looked at, for the unseen accent. */
  seenAt: number | undefined;
  /** Acknowledge it — see the effect in `QueueEntry`. */
  onSeen: (workspaceId: string) => void;
}

/**
 * One workspace, at whichever of the two densities its liveness earns.
 *
 * Both densities are the same element with the same handlers — the same drop
 * target, the same menu, the same keyboard behaviour — so nothing about a
 * workspace changes when a terminal starts in it except how much room it takes.
 */
const QueueEntry = memo(function QueueEntry({
  workspace,
  index,
  count,
  ctx,
  terminals,
  tabIds,
  showShortcut,
  focused,
  seenAt,
  onSeen,
}: QueueEntryProps): ReactNode {
  const [renaming, setRenaming] = useState(false);
  const removeWorkspace = useReviewStore((s) => s.removeWorkspace);
  const isOver = useIsWorkDropTarget(
    useMemo(
      () => ({ kind: "card", itemId: workspace.id }) as const,
      [workspace.id],
    ),
  );

  const status = useMemo(
    () => describeWorkspace(workspace, ctx),
    [workspace, ctx],
  );
  const state = workspaceState(terminals.phase, terminals.tabs > 0);
  const live = state !== "dormant";
  const detailRepos =
    workspace.title === null
      ? status.repos.filter((repo) => repo.chipLabel !== status.title)
      : status.repos;
  // Two ways a queue entry is finished with: its branches are gone, or its PR
  // landed. Both keep their place and offer removal — the app changes what a
  // workspace *says*, and only the user takes one out of the queue.
  const done = status.resolved || !!status.shipped;
  const unseen = isUnseen(
    attentionSignalAt(status, terminals.waitingSince),
    seenAt,
  );

  // A workspace on the stage is one you are looking at, so a signal raised
  // while it is focused is acknowledged as it arrives. Without this, the
  // acknowledgement would be the *moment of focusing* alone, and every signal
  // that landed while you were reading the diff would light the card up the
  // instant you moved on.
  useEffect(() => {
    if (focused && unseen) onSeen(workspace.id);
  }, [focused, unseen, workspace.id, onSeen]);

  const open = useCallback(() => focusWorkspace(workspace), [workspace]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* A div rather than a button because `draggable` on a button is where
            webviews disagree about whether a drag starts at all. */}
        <div
          data-workspace-entry
          data-work-card={workspace.id}
          role="option"
          aria-selected={focused}
          tabIndex={0}
          draggable={!renaming}
          onClick={open}
          onKeyDown={activateOnKey(open)}
          onDragStart={(e) =>
            startWorkspaceDrag(e, { id: workspace.id, index })
          }
          onDragEnd={() => setDraggedWorkspace(null)}
          title={status.subtitle || status.title}
          className={clsx(
            "group relative cursor-default rounded-lg border px-2 py-1.5 outline-none transition-colors duration-100",
            isOver
              ? "border-focus-ring bg-fg/[0.06]"
              : focused
                ? "border-edge-default bg-fg/[0.06]"
                : "border-transparent hover:bg-fg/[0.04]",
            "focus-visible:ring-1 focus-visible:ring-focus-ring/70",
          )}
        >
          {/* Unseen: something changed here since the last time this workspace
              was looked at. A bar on the outer edge rather than another badge
              in the row — it has to be findable by scanning the list's margin.
              Focusing the workspace is what clears it; there is no dismiss. */}
          {unseen && !focused && (
            <span
              aria-hidden="true"
              data-unseen
              className="absolute inset-y-1.5 -left-px w-[2px] rounded-full bg-status-saved"
            />
          )}

          <div className="flex items-center gap-2">
            {/* The card's position, shown only while ⌘ is down — the number
                ⌘1–9 would press. It takes the slot rather than reserving one:
                there is no status mark here any more (a card's terminals carry
                their own phase dots, which is where that question is actually
                read), and a permanently empty box would indent every title for
                the sake of a mark that isn't there. The titles shift for as
                long as the chord is held, which is exactly when the digits,
                not the titles, are what is being read. */}
            {showShortcut && (
              <span
                aria-hidden="true"
                data-shortcut-digit
                className="w-[7px] shrink-0 text-center text-[9px] leading-none text-fg-faint tabular-nums"
              >
                {index + 1}
              </span>
            )}
            {renaming ? (
              <WorkspaceTitleInput
                workspaceId={workspace.id}
                title={workspace.title}
                onDone={() => setRenaming(false)}
                className="min-w-0 flex-1 rounded-sm bg-fg/[0.06] px-1 text-[11.5px]
                           leading-4 text-fg-secondary outline-none"
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenaming(true);
                }}
                className={clsx(
                  "min-w-0 flex-1 truncate text-[11.5px] leading-4",
                  done
                    ? "text-fg-faint/60"
                    : live
                      ? "text-fg-secondary"
                      : "text-fg-muted",
                )}
              >
                {status.title}
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1">
              {done ? (
                <CheckIcon
                  className={clsx(
                    "h-3 w-3",
                    // A merge earns the full-strength tick; a branch that
                    // merely vanished gets the faded one. Same glyph, because
                    // both mean "nothing more to do here".
                    status.shipped
                      ? "text-status-approved"
                      : "text-status-approved/70",
                  )}
                />
              ) : (
                // No "M" beside the PR badge any more: the line below now says
                // how big the working tree is, and a badge that means "there is
                // something uncommitted" is the same fact with less in it.
                status.openPr && <PrBadge pr={status.openPr} />
              )}
              {done && (
                <button
                  type="button"
                  aria-label={`Remove ${status.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeWorkspace(workspace.id);
                  }}
                  className="text-[11px] leading-none text-fg-faint opacity-0
                             transition-opacity duration-100 hover:text-fg-secondary
                             group-hover:opacity-100"
                >
                  ✕
                </button>
              )}
            </span>
          </div>

          {/* Every entry shows its repos and status phrase, focused or not:
              the stage says nothing about the workspace any more, so this card
              is the only place its repos, its PR and how far its review got
              are read — hiding that on dormant entries would make the queue a
              list of bare names. A chip that would just repeat the derived
              title is dropped: the title already is that repo. */}
          {(detailRepos.length > 0 || status.phrase) && (
            <div className="mt-1 flex flex-wrap items-center gap-1 pl-[15px]">
              {detailRepos.map((repo) => (
                <span
                  key={repo.reviewKey}
                  className={clsx(
                    "max-w-full truncate rounded px-1 text-[9.5px] leading-4",
                    repo.gone
                      ? "bg-fg/[0.04] text-fg-faint/50 line-through"
                      : "bg-fg/[0.05] text-status-trusted/80",
                  )}
                  title={repo.attachment.path}
                >
                  {repo.chipLabel}
                </span>
              ))}
              {status.clauses.map((clause, index) => (
                <Fragment key={clause.text}>
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className="text-[9.5px] leading-4 text-fg-faint/50"
                    >
                      ·
                    </span>
                  )}
                  <PhraseClauseText clause={clause} />
                </Fragment>
              ))}
            </div>
          )}

          {/* The workspace's terminals, one line each. The dot above is the
              loudest of them, which is the right summary for a card you are
              scanning past and the wrong one for the card you stopped at: two
              agents working and a third asking for a password read as "asking"
              and say nothing about the other two. Nothing is drawn for a
              workspace running nothing — a heading over an empty list is the
              queue claiming space for something that isn't there. */}
          {tabIds.length > 0 && (
            <div className="mt-1 pl-[15px]">
              {tabIds.map((tabId) => (
                <TerminalRow key={tabId} tabId={tabId} />
              ))}
            </div>
          )}

          {/* The signature line: what a stopped agent is stopped on, on the
              card, so the queue answers "what needs me" without opening
              anything. At most one, and only while something is waiting. */}
          {terminals.waitingOn && (
            <p className="mt-1 truncate pl-[15px] text-[10px] leading-4 text-status-saved/90">
              {terminals.waitingOn}
            </p>
          )}
        </div>
      </ContextMenuTrigger>

      {/* Built when the menu opens, not on every render of every entry: the
          verb list walks the repos and closes over the queue's positions, and
          nothing reads it until there is a menu on screen. */}
      <ContextMenuContent>
        <EntryMenuItems
          workspace={workspace}
          index={index}
          count={count}
          status={status}
          onRename={() => setRenaming(true)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * One clause of the status line.
 *
 * The changes clause is the only one drawn as more than its words: how much is
 * uncommitted is a number you compare across cards, and it reads as one at a
 * glance only if the two signs are the colours the diff itself uses for them.
 * The file count stays the phrase's own grey — it is the noun, not the news.
 */
function PhraseClauseText({ clause }: { clause: PhraseClause }): ReactNode {
  if (!clause.stat) {
    return (
      <span className="truncate text-[9.5px] leading-4 text-fg-faint">
        {clause.text}
      </span>
    );
  }
  // The words come from the same helpers that built `clause.text`, so the line
  // and the tooltip describing it cannot say different things.
  return (
    <span className="flex shrink-0 items-center gap-1 text-[9.5px] leading-4 tabular-nums text-fg-faint">
      <span>{fileCountLabel(clause.stat)}</span>
      <span className="text-diff-added">+{clause.stat.additions}</span>
      <span className="text-diff-removed">−{clause.stat.deletions}</span>
    </span>
  );
}

/** The entry's verbs, resolved only once a menu is actually open. */
function EntryMenuItems({
  workspace,
  index,
  count,
  status,
  onRename,
}: {
  workspace: Workspace;
  index: number;
  count: number;
  status: WorkspaceStatus;
  onRename: () => void;
}): ReactNode {
  return (
    <ContextActionItems
      actions={workspaceActions({ workspace, index, count, status, onRename })}
    />
  );
}
