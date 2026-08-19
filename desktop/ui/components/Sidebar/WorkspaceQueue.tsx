import {
  type ReactNode,
  Fragment,
  memo,
  useCallback,
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
import { workspaceState } from "./StatusDot";
import { TerminalRow } from "./TerminalRow";
import { activateOnKey } from "./row-chrome";
import { prBadgeClass } from "./pr-format";
import { prNeedsAttention } from "../../utils/sidebar-tree";
import { workspaceActions } from "./workspace-actions";
import { removeWorkspaceAndTerminals } from "../Terminal/close";
import { useWorkspaceContext } from "./workspace-context";
import {
  describeWorkspace,
  isNamed,
  prCiFailing,
  type AttachmentStatus,
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
        className="min-h-0 flex-1 space-y-[3px] overflow-y-auto px-1.5 py-1 scrollbar-thin"
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
}: QueueEntryProps): ReactNode {
  const [renaming, setRenaming] = useState(false);
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
  // Nobody typed a title, so the card is wearing a derived one — rendered in
  // italics, and the chip it stands for is *absorbed*: a derived title is
  // definitionally the first attachment's label, so that chip's row is not
  // drawn and its marks — the PR number, the dirty dot — move up beside the
  // title instead. Decided structurally rather than by comparing label
  // strings, which silently failed to absorb whenever the chip spelled the
  // repo by its remote name while the title used the directory's.
  const derived = !isNamed(workspace);
  const absorbed = derived ? status.repos[0] : undefined;
  const detailRepos = status.repos.filter((repo) => repo !== absorbed);
  // Two ways a queue entry is finished with: its branches are gone, or its PR
  // landed. Both keep their place and offer removal — the app changes what a
  // workspace *says*, and only the user takes one out of the queue.
  const done = status.resolved || !!status.shipped;
  // The one changes-requested PR this card shows, wherever its chip ended up.
  const changesRequested =
    status.openPr && prNeedsAttention(status.openPr) ? status.openPr : null;

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
          title={status.subtitle || workspace.displayTitle}
          className={clsx(
            // A real container, not a hover ghost: entries are individually
            // clickable and draggable, and with the status phrase gone the
            // queue needs the card edge to say where one workspace ends.
            "group relative cursor-default rounded-lg border px-2 py-1.5 outline-none transition-colors duration-100",
            isOver
              ? "border-focus-ring bg-fg/[0.06]"
              : focused
                ? "border-edge-default bg-fg/[0.06]"
                : "border-edge bg-fg/[0.03] hover:bg-fg/[0.05]",
            "focus-visible:ring-1 focus-visible:ring-focus-ring/70",
          )}
        >
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
                  // A derived title in italics: same weight and colour as a
                  // typed one — it is not less true — but visibly implicit,
                  // and a quiet hint that double-clicking here names it.
                  derived && "italic",
                  done
                    ? "text-fg-faint/60"
                    : live
                      ? "text-fg-secondary"
                      : "text-fg-muted",
                )}
              >
                {workspace.displayTitle}
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
                // The absorbed chip's marks, worn by the title that swallowed
                // it — so a one-line `repo · branch` card still says its PR
                // and its dirtiness. Cards whose chips are drawn below carry
                // these on the chips instead.
                absorbed && <ChipMarks repo={absorbed} />
              )}
              {done && (
                <button
                  type="button"
                  aria-label={`Remove ${workspace.displayTitle}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeWorkspaceAndTerminals(workspace.id);
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

          {/* Every entry shows its repos, focused or not: the stage says
              nothing about the workspace any more, so this card is the only
              place its repos and their PRs are read — hiding that on dormant
              entries would make the queue a list of bare names. Each chip
              carries its own branch's facts (see `RepoChip`); the chip a
              derived title already is gets absorbed instead (see `absorbed`).
              Red CI is words, not colour — red here means a reviewer asked
              for changes and nothing else. */}
          {(detailRepos.length > 0 ||
            (status.openPr && prCiFailing(status.openPr))) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {detailRepos.map((repo) => (
                <RepoChip key={repo.reviewKey} repo={repo} />
              ))}
              {status.openPr && prCiFailing(status.openPr) && (
                <span className="text-[9.5px] leading-4 text-fg-faint">
                  CI failing
                </span>
              )}
            </div>
          )}

          {/* The workspace's terminals, one line each — always, when there are
              any: the title above is what the workspace is about, and these
              rows are what is running in it, each wearing its own phase dot
              and pane count. Nothing is drawn for a workspace running nothing
              — a heading over an empty list is the queue claiming space for
              something that isn't there. The negative margin lets a row's
              hover ground bleed while its text stays flush with the card's
              own lines. */}
          {tabIds.length > 0 && (
            <div className="-mx-1 mt-1">
              {tabIds.map((tabId) => (
                <TerminalRow key={tabId} tabId={tabId} />
              ))}
            </div>
          )}

          {/* The signal line: the one thing here that wants a person, in
              words. A stopped agent's own question, or the reviewer's verdict
              — the same kind of fact, so they share the slot — and the good
              ending when the story is over. At most one; a waiting terminal
              that said nothing shows nothing, because that it is waiting is
              what its phase marker is for. */}
          {status.shipped ? (
            <p className="mt-1 truncate text-[10px] leading-4 text-status-approved/85">
              #{status.shipped.number} merged
            </p>
          ) : terminals.waitingOn ? (
            <p className="mt-1 truncate text-[10px] leading-4 text-status-saved/90">
              {terminals.waitingOn}
            </p>
          ) : changesRequested ? (
            <p className="mt-1 truncate text-[10px] leading-4 text-pr-attention/90">
              changes requested
            </p>
          ) : null}
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
 * The marks a branch's chip carries: its PR number in GitHub's colours, and an
 * amber dot when its working tree is dirty. Their own component because they
 * are drawn in two places — on the chip, and beside a title that absorbed one.
 */
function ChipMarks({ repo }: { repo: AttachmentStatus }): ReactNode {
  return (
    <>
      {repo.openPr && (
        <span
          className={clsx(
            "shrink-0 text-[9.5px] leading-4 tabular-nums",
            prBadgeClass(repo.openPr),
          )}
        >
          #{repo.openPr.number}
        </span>
      )}
      {repo.hasChanges && (
        <span
          title="Uncommitted changes"
          className="shrink-0 text-[9.5px] leading-4 text-status-saved"
        >
          •
        </span>
      )}
    </>
  );
}

/**
 * One attachment, as `repo · branch` plus the facts that belong to that
 * branch. The label is what truncates — the marks are pinned outside the
 * ellipsis, because state must never be the first thing a long branch name
 * pushes off the card.
 */
function RepoChip({ repo }: { repo: AttachmentStatus }): ReactNode {
  return (
    <span
      className="flex min-w-0 max-w-full items-center gap-1 rounded bg-fg/[0.05] px-1"
      title={repo.attachment.path}
    >
      <span
        className={clsx(
          "min-w-0 truncate text-[9.5px] leading-4",
          repo.gone
            ? "text-fg-faint/50 line-through"
            : "text-status-trusted/80",
        )}
      >
        {repo.chipLabel}
      </span>
      <ChipMarks repo={repo} />
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
