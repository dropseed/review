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
import { useWorkItems } from "../../stores/selectors/work";
import {
  useCurrentTabId,
  usePhasesByItemId,
  useTabsByItemId,
} from "../../stores/selectors/terminals";
import { activateWorkItem, activateWorkRef } from "../../commands/workCommands";
import type { TerminalPhase, WorkItem, WorkRef } from "../../types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { CheckIcon } from "../ui/icons";
import { ActionContextMenu, ContextActionItems } from "./ActionMenu";
import { PhaseDot } from "./PhaseDot";
import { PrBadge } from "./PrBadge";
import { TerminalRow } from "./TerminalRow";
import { activateOnKey, ROW_MODIFIED_BADGE } from "./row-chrome";
import { workItemActions, workRefActions } from "./work-actions";
import { useAddWorkItemRequests } from "./work-add";
import { useWorkContext } from "./work-context";
import { describeWorkItem, type WorkContext } from "./work-status";
import {
  setDraggedWorkItem,
  setDraggedWorkRef,
  startWorkItemDrag,
  startWorkRefDrag,
  useWorkDropTarget,
  workSectionDropHandlers,
} from "./work-drag";

/**
 * "Working on": the user's own ordered list of what they are doing.
 *
 * The one part of the sidebar that isn't derived. Everything below it answers
 * "what exists"; this answers "what am I on", which only the user can say — so
 * order is theirs, membership is theirs, and the app's contribution is the
 * status each card carries (see `work-status`).
 */
export function WorkingOnSection(): ReactNode {
  const items = useWorkItems();
  const ctx = useWorkContext();
  const tabsByItem = useTabsByItemId();
  const phasesByItem = usePhasesByItemId();
  const currentTabId = useCurrentTabId();
  const addWorkItem = useReviewStore((s) => s.addWorkItem);

  return (
    <div className="border-b border-b-edge/40 pb-1.5 pt-1">
      <div className="px-2.5 pb-0.5 pt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-fg-faint/60">
        Working on
      </div>
      {/* The one drop surface: targets are computed from the cursor position
          against the measured cards (`resolveWorkDropTarget`), not owned by
          the elements — the gaps and cards below just draw the result. */}
      <div
        data-work-section
        {...workSectionDropHandlers()}
        className="space-y-1 px-1.5"
      >
        {items.map((item, index) => (
          <Fragment key={item.id}>
            <DropGap index={index} />
            <WorkCard
              item={item}
              index={index}
              count={items.length}
              ctx={ctx}
              tabIds={tabsByItem[item.id]}
              phase={phasesByItem[item.id] ?? null}
              currentTabId={currentTabId}
            />
          </Fragment>
        ))}
        <DropGap index={items.length} />
      </div>
      <AddRow onAdd={(title) => void addWorkItem(title, [])} />
      <WorkError />
    </div>
  );
}

/**
 * The last refused mutation, as a line under the cards.
 *
 * Inline rather than a toast: the message is about this list — usually that
 * another card already holds the ref you just dropped — and it should be read
 * next to the card that refused it, then be gone by the next gesture.
 */
function WorkError(): ReactNode {
  const error = useReviewStore((s) => s.lastWorkError);
  if (!error) return null;
  return (
    <p className="px-2.5 pt-1 text-[10px] leading-snug text-status-rejected/80">
      {error.message}
    </p>
  );
}

/**
 * The insertion line between two cards, and at the section's own end.
 *
 * Purely an indicator: zero net height, never a pointer target. Which gap is
 * lit is decided by the section's geometry (`resolveWorkDropTarget`), and the
 * line is drawn over the gap rather than by displacing the cards —
 * displacement mid-drag moves the target out from under the cursor.
 */
function DropGap({ index }: { index: number }): ReactNode {
  const target = useWorkDropTarget();
  const isOver = target?.kind === "gap" && target.index === index;

  return (
    <div className="pointer-events-none relative -my-0.5 h-1">
      {isOver && (
        <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 rounded-full bg-focus-ring" />
      )}
    </div>
  );
}

/** Hover-revealed drag grip. */
function Grip(): ReactNode {
  return (
    <span
      className="w-2 shrink-0 cursor-grab text-[9px] leading-none text-fg-faint/0
                 transition-colors duration-100 group-hover:text-fg-faint/60"
      aria-hidden="true"
    >
      ⠿
    </span>
  );
}

const NO_TABS: string[] = [];

const WorkCard = memo(function WorkCard({
  item,
  index,
  count,
  ctx,
  phase,
  currentTabId,
  tabIds = NO_TABS,
}: {
  item: WorkItem;
  index: number;
  /** How many cards there are — what the move verbs are bounded by. */
  count: number;
  ctx: WorkContext;
  /** The loudest phase among the item's own terminals — see `usePhasesByItemId`. */
  phase: TerminalPhase | null;
  currentTabId: string | null;
  tabIds?: string[];
}): ReactNode {
  const removeWorkItem = useReviewStore((s) => s.removeWorkItem);
  const renameWorkItem = useReviewStore((s) => s.renameWorkItem);
  const [renaming, setRenaming] = useState(false);
  const target = useWorkDropTarget();

  const status = useMemo(() => describeWorkItem(item, ctx), [item, ctx]);
  const actions = workItemActions({
    item,
    index,
    count,
    status,
    onRename: () => setRenaming(true),
  });

  const isOver = target?.kind === "card" && target.itemId === item.id;

  // Shared with ⌘1–9 and the collapsed rail, so a card and its number can't
  // open different things.
  const activate = useCallback(() => activateWorkItem(item), [item]);

  return (
    <ContextMenu>
      <div>
        <ContextMenuTrigger asChild>
          {/* A div rather than a button for the same reason the terminal rows
              are: `draggable` on a button is where webviews disagree about
              whether a drag starts at all. */}
          <div
            role="button"
            tabIndex={0}
            draggable={!renaming}
            data-work-card={item.id}
            onClick={activate}
            onKeyDown={activateOnKey(activate)}
            onDragStart={(e) => startWorkItemDrag(e, { id: item.id, index })}
            onDragEnd={() => setDraggedWorkItem(null)}
            className={clsx(
              // Borderless: the number, indent and hover carry the card. A
              // border on every item made the queue the heaviest surface in
              // the sidebar; the drop target keeps one so "will accept" still
              // reads as a shape.
              `group flex cursor-default items-start gap-2 rounded-md border px-2 py-1
               transition-colors duration-100`,
              isOver
                ? "border-focus-ring bg-fg/[0.06]"
                : "border-transparent hover:bg-fg/[0.04]",
            )}
            title={status.phrase || status.title}
          >
            {/* A resolved card keeps its place and number until the user
                removes it — the app changes a card's status, only the user
                removes a card. */}
            <span className="relative w-3 shrink-0 pt-px text-right text-[10px] tabular-nums leading-4 text-fg-faint/50">
              <span
                className={
                  status.resolved ? "group-hover:opacity-0" : undefined
                }
              >
                {index + 1}
              </span>
              {status.resolved && (
                <button
                  type="button"
                  aria-label="Remove from Working on"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeWorkItem(item.id);
                  }}
                  className="absolute inset-0 flex items-center justify-end text-[11px] leading-none
                             text-fg-faint opacity-0 transition-opacity duration-100
                             hover:text-fg-secondary group-hover:opacity-100"
                >
                  ✕
                </button>
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {renaming ? (
                  <RenameInput
                    initial={item.title}
                    onDone={(title) => {
                      setRenaming(false);
                      if (title !== item.title)
                        void renameWorkItem(item.id, title);
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenaming(true);
                    }}
                    className={clsx(
                      "min-w-0 truncate text-[11px] leading-4",
                      status.resolved
                        ? "text-fg-faint/60"
                        : "text-fg-secondary",
                    )}
                  >
                    {status.title}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1">
                  {status.resolved ? (
                    <CheckIcon className="h-3 w-3 text-status-approved/70" />
                  ) : (
                    <>
                      {phase && <PhaseDot phase={phase} />}
                      {status.openPr && <PrBadge pr={status.openPr} />}
                      {status.hasChanges && (
                        <span className={ROW_MODIFIED_BADGE}>M</span>
                      )}
                    </>
                  )}
                </span>
              </span>
              <span
                className={clsx(
                  "block truncate text-[10px] leading-3.5",
                  status.resolved ? "text-fg-faint/30" : "text-fg-faint/70",
                )}
              >
                {status.subtitle}
              </span>
              {/* Chips only once a card holds more than one ref: with a single
                  one the title line already names it. */}
              {status.refs.length > 1 && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {status.refs.map((refStatus) => (
                    <RefChip
                      key={refStatus.reviewKey}
                      itemId={item.id}
                      refValue={refStatus.ref}
                      label={refStatus.chipLabel}
                      gone={refStatus.gone}
                    />
                  ))}
                </span>
              )}
            </span>
            <Grip />
          </div>
        </ContextMenuTrigger>

        {/* The item's terminals, one row per tab, under the card that claimed
            them. */}
        {tabIds.length > 0 && (
          <div className="ml-[18px] border-l border-l-fg/[0.06]">
            {tabIds.map((tabId) => (
              <TerminalRow
                key={tabId}
                tabId={tabId}
                isActive={tabId === currentTabId}
              />
            ))}
          </div>
        )}
      </div>

      <ContextMenuContent>
        <ContextActionItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * One bound ref on a card holding several.
 *
 * A noun in its own right: it can be dragged onto another card, clicked to open
 * the review it names, and right-clicked for the same verbs the drag performs.
 * The click is stopped from reaching the card, whose own click opens the item's
 * *first* ref — on a multi-ref card that is precisely the ref the user was
 * pointing away from.
 */
function RefChip({
  itemId,
  refValue,
  label,
  gone,
}: {
  itemId: string;
  refValue: WorkRef;
  label: string;
  gone: boolean;
}): ReactNode {
  const items = useWorkItems();

  return (
    <ActionContextMenu
      actions={workRefActions({ ref: refValue, fromItemId: itemId, items })}
    >
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          startWorkRefDrag(e, { ref: refValue, fromItemId: itemId });
        }}
        onDragEnd={() => setDraggedWorkRef(null)}
        onClick={(e) => {
          e.stopPropagation();
          activateWorkRef(refValue);
        }}
        className={clsx(
          "max-w-full cursor-grab truncate rounded-sm bg-fg/[0.05] px-1 text-[9px] leading-4",
          gone ? "text-fg-faint/40 line-through" : "text-fg-faint",
        )}
        title={`${refValue.repoPath} — ${refValue.ref}`}
      >
        {label}
      </span>
    </ActionContextMenu>
  );
}

function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (title: string) => void;
}): ReactNode {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value.trim());
        if (e.key === "Escape") onDone(initial);
      }}
      className="min-w-0 flex-1 rounded-sm bg-fg/[0.06] px-1 text-[11px] leading-4
                 text-fg-secondary outline-none"
    />
  );
}

/**
 * The section's one-line "Add…" affordance, which becomes its own input in
 * place — a quiet row rather than a button, because adding to this list is the
 * ordinary thing to do with it and a button would say otherwise.
 *
 * It is also what the sidebar header's `+` opens: the header has no list of its
 * own to add to, so its button reaches this one rather than being a second way
 * to create a work item.
 */
function AddRow({ onAdd }: { onAdd: (title: string) => void }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const requests = useAddWorkItemRequests();
  // The count is module-wide and survives this component, so what opens the
  // row is a change since it mounted — not a non-zero count.
  const seen = useRef(requests);

  useEffect(() => {
    if (requests === seen.current) return;
    seen.current = requests;
    setEditing(true);
    // Already open — `autoFocus` fires on mount only, so a second press has to
    // take the focus here or it does nothing visible.
    inputRef.current?.focus();
  }, [requests]);

  const commit = () => {
    const title = value.trim();
    if (title) onAdd(title);
    setValue("");
    // Kept open: adding one thing is usually adding two.
    inputRef.current?.focus();
  };

  return (
    <div className="px-1.5 pt-1">
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={value}
          placeholder="What are you working on?"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (!value.trim()) setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setValue("");
              setEditing(false);
            }
          }}
          className="w-full rounded-sm bg-fg/[0.04] px-2.5 py-0.5 text-[11px]
                     text-fg-secondary outline-none placeholder:text-fg-faint/40"
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={activateOnKey(() => setEditing(true))}
          className="flex cursor-text items-center gap-1.5 rounded-sm px-2.5 py-0.5
                     text-[11px] text-fg-faint/40 transition-colors duration-100
                     hover:bg-fg/[0.03] hover:text-fg-faint"
        >
          <span className="w-2 shrink-0" />
          <span>Add…</span>
        </div>
      )}
    </div>
  );
}
