import { type DragEvent, type ReactNode, Fragment, useRef } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import {
  type PaneNode,
  type SplitDirection,
  type DropEdge,
  showsTerminal,
} from "./pane-tree";
import { CollapsedPane } from "./CollapsedPane";
import {
  TERMINAL_PANE_MIME,
  clearPaneDropTarget,
  edgeForPoint,
  pointerLeft,
  setDraggedPane,
  setPaneDropTarget,
  usePaneDragActive,
  usePaneDropEdge,
} from "./pane-drag";
import { TerminalPane } from "./TerminalPane";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { SplitDivider } from "./SplitDivider";

/** Smallest fraction a pane can be dragged to, so a pane never vanishes. */
const MIN_PANE_FRACTION = 0.1;

interface PaneTreeProps {
  node: PaneNode;
  /** Child-index path from the tab root to this node (for size updates). */
  path: number[];
  /**
   * The direction of the split this node sits in, or null at the tab root.
   * A leaf folds along its parent's axis, and the root has no axis to fold on.
   */
  parentDirection?: SplitDirection | null;
  /**
   * Whether folding is offered at all — false once the tab is down to the one
   * pane still showing, since folding that one is declined anyway and a button
   * that does nothing is worse than no button.
   */
  canFold: boolean;
  tabId: string;
  /** terminalId of the tab's focused leaf. */
  focusedId: string;
  /** Whether this tab is the visible one (drives auto-focus of the focused pane). */
  tabActive: boolean;
  /**
   * Render every leaf as a viewer — at the PTY's true grid, scaled, never
   * resizing it. The overview passes this: looking at a terminal there must
   * not reflow it for whoever is actually working in it.
   */
  viewer?: boolean;
  onFocus: (terminalId: string) => void;
  onClose: (terminalId: string) => void;
}

/** The half of a pane a drop would fill, drawn where the pane will land. */
const EDGE_HIGHLIGHT: Record<DropEdge, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
};

/** Stable React key so xterm panes aren't remounted when siblings change. */
function nodeKey(node: PaneNode, index: number): string {
  return node.type === "leaf" ? `leaf-${node.terminalId}` : `split-${index}`;
}

/**
 * Recursively render a tab's pane tree: a leaf becomes a kept-alive
 * <TerminalPane>, a split becomes a flex row/column of children separated by
 * draggable dividers. All leaves render simultaneously (that's the point of
 * splits); the enclosing tab is hidden, not unmounted, when inactive.
 */
export function PaneTree({
  node,
  path,
  parentDirection = null,
  canFold,
  tabId,
  focusedId,
  tabActive,
  viewer = false,
  onFocus,
  onClose,
}: PaneTreeProps): ReactNode {
  const resizeSplit = useReviewStore((s) => s.resizeSplit);
  const setPaneCollapsed = useReviewStore((s) => s.setPaneCollapsed);

  if (node.type === "leaf") {
    // A folded pane shows its title bar instead of its terminal. Clicking it
    // focuses the pane, and focusing a pane unfolds it — one path back.
    if (node.collapsed && parentDirection) {
      return (
        <CollapsedPane
          id={node.terminalId}
          direction={parentDirection}
          onExpand={() => onFocus(node.terminalId)}
          onClose={() => onClose(node.terminalId)}
        />
      );
    }
    return (
      <PaneLeaf
        id={node.terminalId}
        // A leaf at the tab root is the only pane, so there's nothing to
        // contrast it against — dimming it would just make the whole panel
        // look asleep, and it has nowhere to be dragged or folded to either.
        isOnlyPane={parentDirection === null}
        foldDirection={canFold ? parentDirection : null}
        isFocused={tabActive && node.terminalId === focusedId}
        // "Which of these has the keyboard" is a question only the tab on
        // screen has an answer to. The panel never draws two tabs at once so it
        // could not tell the difference, but the overview draws every tab side
        // by side — and there, dimming each unselected tab's panes made a row
        // of split terminals read as a row of asleep ones.
        tabActive={tabActive}
        viewer={viewer}
        onFocus={onFocus}
        onCollapse={() => setPaneCollapsed(tabId, node.terminalId, true)}
      />
    );
  }

  const { children, sizes } = node;

  // A branch with nothing left to draw lays its bars out along the *parent's*
  // axis instead of its own: its direction was a way of sharing space, and it
  // has no space left to share. Without this the branch is sized by its
  // contents, which for a stack of turned-on-their-side titles means a band as
  // wide as the longest one.
  const direction = showsTerminal(node)
    ? node.direction
    : (parentDirection ?? node.direction);

  // Folded children hold a fixed bar's worth of space rather than a fraction,
  // so the fractions of the ones still showing are renormalized over each
  // other. Flex only distributes all the free space when the grow factors sum
  // to 1 — leaving a folded child's share out would strand that much of the
  // split empty.
  const flexing = children.map(showsTerminal);
  const flexTotal = sizes.reduce((a, s, i) => (flexing[i] ? a + s : a), 0);

  // The child each divider trades space with — the nearest one before it that
  // is still drawn, which is not always its neighbour. Folding the middle of a
  // three-way split still leaves its two outer panes side by side, and they
  // should still be resizable against each other.
  const partner: (number | null)[] = [];
  let previous: number | null = null;
  children.forEach((_, i) => {
    partner[i] = flexing[i] ? previous : null;
    if (flexing[i]) previous = i;
  });

  const handleBoundaryResize = (
    left: number,
    right: number,
    fractionOfPair: number,
  ) => {
    // The fraction is where the pointer sits between those two children — the
    // only two whose sizes a divider moves.
    const pairTotal = sizes[left] + sizes[right];
    // A pane never shrinks to nothing, but in a many-way split the pair may be
    // small enough that the flat floor wouldn't fit twice.
    const min = Math.min(MIN_PANE_FRACTION, pairTotal / 3);
    const first = Math.max(
      min,
      Math.min(pairTotal - min, pairTotal * fractionOfPair),
    );
    const next = [...sizes];
    next[left] = first;
    next[right] = pairTotal - first;
    resizeSplit(tabId, path, next);
  };

  return (
    <div
      className={clsx(
        "flex h-full w-full min-w-0 min-h-0",
        direction === "row" ? "flex-row" : "flex-col",
      )}
    >
      {children.map((child, i) => {
        const left = partner[i];
        return (
          <Fragment key={nodeKey(child, i)}>
            {left !== null && (
              <SplitDivider
                direction={direction}
                leftSlot={left}
                rightSlot={i}
                onResize={(fraction) => handleBoundaryResize(left, i, fraction)}
              />
            )}
            <div
              // Read back by the divider, which resizes two panes that a folded
              // one may be sitting between.
              data-pane-slot={i}
              className={clsx(
                "min-w-0 min-h-0 overflow-hidden",
                !flexing[i] && "flex-none",
              )}
              style={
                flexing[i]
                  ? { flexGrow: sizes[i] / flexTotal, flexBasis: 0 }
                  : undefined
              }
            >
              <PaneTree
                node={child}
                path={[...path, i]}
                parentDirection={direction}
                canFold={canFold}
                tabId={tabId}
                focusedId={focusedId}
                tabActive={tabActive}
                viewer={viewer}
                onFocus={onFocus}
                onClose={onClose}
              />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

interface PaneLeafProps {
  id: string;
  isOnlyPane: boolean;
  /** The axis this pane would fold along, or null when it can't be folded. */
  foldDirection: SplitDirection | null;
  isFocused: boolean;
  /** Whether this pane's tab is the one on screen — see the veil below. */
  tabActive: boolean;
  /** See PaneTreeProps.viewer. */
  viewer: boolean;
  onFocus: (terminalId: string) => void;
  onCollapse: () => void;
}

/**
 * One terminal in the tree: the kept-alive <TerminalPane>, its hover chrome,
 * and its half of the drag-to-rearrange gesture — both ends of it, since a pane
 * is equally the thing being carried and the thing being dropped on.
 */
function PaneLeaf({
  id,
  isOnlyPane,
  foldDirection,
  isFocused,
  tabActive,
  viewer,
  onFocus,
  onCollapse,
}: PaneLeafProps): ReactNode {
  const dropPaneOn = useReviewStore((s) => s.dropPaneOn);
  const searchOpen = useReviewStore((s) => s.terminalSearchId === id);
  // Where a drop would land, whichever way the drag reached us: these handlers
  // in web mode, the window-level events under Tauri (see useTerminalFileDrop).
  // Both publish to pane-drag, so the highlight has one source either way.
  const dropEdge = usePaneDropEdge(id);
  // Derived rather than tracked separately: the module value is what the tab
  // strip already reads, and a second copy of "this pane is in flight" is one
  // that can be left behind set when a drop unmounts this pane's grip.
  const lifted = usePaneDragActive() === id;

  // The pane's box can't move while a drag is in flight, so it is measured once
  // per drag instead of per `dragover`. The handler itself dirties layout (the
  // highlight is added and moved), which would make every one of those reads a
  // forced reflow — over a document that also holds a streaming terminal.
  const rectRef = useRef<DOMRect | null>(null);
  const edgeAt = (e: DragEvent<HTMLDivElement>): DropEdge => {
    rectRef.current ??= e.currentTarget.getBoundingClientRect();
    return edgeForPoint(rectRef.current, e.clientX, e.clientY);
  };
  const endHover = () => {
    rectRef.current = null;
    clearPaneDropTarget(id);
  };

  return (
    <div
      // Hit-tested by useTerminalFileDrop to route a dropped file's path to
      // this pane's PTY.
      data-terminal-id={id}
      className={clsx(
        "group/pane relative flex h-full w-full min-w-0 min-h-0 flex-col",
        // The panel card supplies the surface and the rounding; this is the
        // one gutter between the card edge and the terminal text.
        "overflow-hidden p-1.5",
        // The pane in flight reads as picked up rather than gone — its
        // contents still say which terminal you are carrying.
        lifted && "opacity-50",
      )}
      onMouseDown={() => onFocus(id)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TERMINAL_PANE_MIME)) return;
        // A pane hovering itself is not a drop: leaving dragover uncancelled
        // makes the browser refuse the drop outright, so the terminal
        // underneath never sees a stray text insertion either.
        if (lifted) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setPaneDropTarget({ paneId: id, edge: edgeAt(e) });
      }}
      onDragLeave={(e) => {
        if (pointerLeft(e)) endHover();
      }}
      onDrop={(e) => {
        const source = e.dataTransfer.getData(TERMINAL_PANE_MIME);
        e.preventDefault();
        e.stopPropagation();
        // Re-read the edge from the drop itself rather than trusting the
        // published one, which is a `dragover` behind a fast gesture.
        const edge = edgeAt(e);
        endHover();
        // The drop may unmount the grip that started the drag, and a `dragend`
        // is not guaranteed once that happens — so the drag is ended here
        // rather than left for the element that is about to disappear.
        setDraggedPane(null);
        if (source) dropPaneOn(source, id, edge);
      }}
    >
      <div className="relative min-h-0 flex-1">
        <TerminalPane id={id} active={isFocused} viewer={viewer} />
        {/* Above the focus veil: a pane being searched is being looked at. */}
        {searchOpen && (
          <div className="absolute top-0 right-0 z-10 p-2">
            <TerminalSearchBar id={id} />
          </div>
        )}
        {/* Focus reads as the pane that isn't faded, rather than a border
            drawn around it — one less line inside an already busy panel.
            This is a veil of the terminal's own background rather than
            `opacity` on the pane: fading the element composites its text
            against the app chrome behind it, which tints the output and
            washes it out, while a veil settles it toward the background it
            already sits on. Reads as "still a terminal, just not this one".
            Non-interactive, so a click still focuses the pane underneath.

            Only within the tab on screen: a tab nobody has selected has no
            pane holding the keyboard, so there is nothing for the veil to
            contrast against and every pane would wear it. */}
        {tabActive && !isFocused && !isOnlyPane && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[5] bg-surface-inset/30 transition-opacity"
          />
        )}
      </div>

      {/* Where the dragged pane would land. Inert, so the pointer keeps
          reaching the pane underneath and the edge keeps updating. */}
      {dropEdge && (
        <div
          aria-hidden
          className={clsx(
            "pointer-events-none absolute z-20 m-1.5 rounded",
            "bg-focus-ring/20 ring-1 ring-inset ring-focus-ring",
            EDGE_HIGHLIGHT[dropEdge],
          )}
        />
      )}

      {/* Hover affordances: move, and fold. Splitting, closing and the menu
          used to sit here too — they are ⌘D / ⇧⌘D, ⌘W, and a right-click on
          the tab, and six controls floating over a shell's output cost more
          attention than the gestures they duplicated. What is left is the one
          thing with no keyboard equivalent (the grip) and the one that folds
          the pane away. */}
      <div
        className={clsx(
          `absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5
               rounded-md bg-surface-raised/90 p-0.5 transition-opacity`,
          "opacity-0 group-hover/pane:opacity-100",
        )}
      >
        {/* The only pane in the tab has nowhere to be moved to. A div rather
            than a button: this is a drag handle, and `draggable` on a button
            is the one place webviews disagree about whether a drag starts. */}
        {!isOnlyPane && (
          <div
            role="button"
            aria-label="Move pane"
            title="Drag to move pane"
            draggable
            onDragStart={(e) => {
              setDraggedPane(id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(TERMINAL_PANE_MIME, id);
              // Some webviews won't start a drag without a text payload, and
              // an empty one is a payload that can't be pasted into whatever
              // the drag is released over.
              e.dataTransfer.setData("text/plain", "");
            }}
            onDragEnd={() => setDraggedPane(null)}
            className={clsx(
              PANE_CONTROL_CLASS,
              "cursor-grab active:cursor-grabbing",
            )}
          >
            <GripIcon />
          </div>
        )}
        {/* Folding needs somewhere for the space to go, so the tab's only pane
            doesn't offer it — ⌘` hides the whole panel instead. */}
        {foldDirection && (
          <PaneButton label="Collapse pane (⌥⌘M)" onClick={onCollapse}>
            <CollapseIcon direction={foldDirection} />
          </PaneButton>
        )}
      </div>
    </div>
  );
}

/** Shared look of every control in a pane's hover chrome — including the grip,
 *  which can't be a PaneButton because it has to be draggable. */
const PANE_CONTROL_CLASS =
  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-faint " +
  "transition-colors hover:bg-fg/[0.08] hover:text-fg-secondary";

interface PaneButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  /** Set when the button reflects a state (e.g. a toggle). */
  pressed?: boolean;
}

/** The small square icon button the pane chrome draws its one control with. */
function PaneButton({
  label,
  onClick,
  children,
  pressed,
}: PaneButtonProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={PANE_CONTROL_CLASS}
    >
      {children}
    </button>
  );
}

/** Grip dots — the handle a pane is dragged by. */
function GripIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="currentColor"
      aria-hidden="true"
    >
      {[4, 8, 12].map((y) => (
        <Fragment key={y}>
          <circle cx="6" cy={y} r="1.1" />
          <circle cx="10" cy={y} r="1.1" />
        </Fragment>
      ))}
    </svg>
  );
}

/** Arrows squeezing together along the axis the pane folds on. */
function CollapseIcon({ direction }: { direction: SplitDirection }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className={clsx("h-3.5 w-3.5", direction === "row" && "rotate-90")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
      <path d="M5.5 2.5 8 5 10.5 2.5" />
      <path d="M5.5 13.5 8 11 10.5 13.5" />
    </svg>
  );
}
