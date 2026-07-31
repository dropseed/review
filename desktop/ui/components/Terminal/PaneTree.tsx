import {
  type DragEvent,
  type ReactNode,
  Fragment,
  useRef,
  useState,
} from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import type { PaneNode, SplitDirection, DropEdge } from "./pane-tree";
import {
  TERMINAL_PANE_MIME,
  edgeForPoint,
  pointerLeft,
  setDraggedPane,
  usePaneDragActive,
} from "./pane-drag";
import { TerminalPane } from "./TerminalPane";
import { SplitDivider } from "./SplitDivider";

/** Smallest fraction a pane can be dragged to, so a pane never vanishes. */
const MIN_PANE_FRACTION = 0.1;

interface PaneTreeProps {
  node: PaneNode;
  /** Child-index path from the tab root to this node (for size updates). */
  path: number[];
  reviewKey: string;
  tabId: string;
  /** terminalId of the tab's focused leaf. */
  focusedId: string;
  /** Whether this tab is the visible one (drives auto-focus of the focused pane). */
  tabActive: boolean;
  onFocus: (terminalId: string) => void;
  onSplit: (terminalId: string, direction: SplitDirection) => void;
  onClose: (terminalId: string) => void;
  /** Drag-to-rearrange: place `sourceId` against `edge` of `targetId`. */
  onMovePane: (sourceId: string, targetId: string, edge: DropEdge) => void;
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
  reviewKey,
  tabId,
  focusedId,
  tabActive,
  onFocus,
  onSplit,
  onClose,
  onMovePane,
}: PaneTreeProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeSplit = useReviewStore((s) => s.resizeSplit);

  if (node.type === "leaf") {
    return (
      <PaneLeaf
        id={node.terminalId}
        // A leaf at the tab root is the only pane, so there's nothing to
        // contrast it against — dimming it would just make the whole panel
        // look asleep, and it has nowhere to be dragged to either.
        isOnlyPane={path.length === 0}
        isFocused={tabActive && node.terminalId === focusedId}
        onFocus={onFocus}
        onSplit={onSplit}
        onClose={onClose}
        onMovePane={onMovePane}
      />
    );
  }

  const { direction, children, sizes } = node;

  const handleBoundaryResize = (boundary: number, fraction: number) => {
    // `boundary` is the divider between children[boundary-1] and [boundary].
    const pairStart = sizes.slice(0, boundary - 1).reduce((a, b) => a + b, 0);
    const pairTotal = sizes[boundary - 1] + sizes[boundary];
    let first = fraction - pairStart;
    first = Math.max(
      MIN_PANE_FRACTION,
      Math.min(pairTotal - MIN_PANE_FRACTION, first),
    );
    const next = [...sizes];
    next[boundary - 1] = first;
    next[boundary] = pairTotal - first;
    resizeSplit(reviewKey, tabId, path, next);
  };

  return (
    <div
      ref={containerRef}
      className={clsx(
        "flex h-full w-full min-w-0 min-h-0",
        direction === "row" ? "flex-row" : "flex-col",
      )}
    >
      {children.map((child, i) => (
        <Fragment key={nodeKey(child, i)}>
          {i > 0 && (
            <SplitDivider
              direction={direction}
              containerRef={containerRef}
              onResize={(fraction) => handleBoundaryResize(i, fraction)}
            />
          )}
          <div
            className="min-w-0 min-h-0 overflow-hidden"
            style={{ flexGrow: sizes[i], flexBasis: 0 }}
          >
            <PaneTree
              node={child}
              path={[...path, i]}
              reviewKey={reviewKey}
              tabId={tabId}
              focusedId={focusedId}
              tabActive={tabActive}
              onFocus={onFocus}
              onSplit={onSplit}
              onClose={onClose}
              onMovePane={onMovePane}
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

interface PaneLeafProps {
  id: string;
  isOnlyPane: boolean;
  isFocused: boolean;
  onFocus: (terminalId: string) => void;
  onSplit: (terminalId: string, direction: SplitDirection) => void;
  onClose: (terminalId: string) => void;
  onMovePane: (sourceId: string, targetId: string, edge: DropEdge) => void;
}

/**
 * One terminal in the tree: the kept-alive <TerminalPane>, its hover chrome,
 * and its half of the drag-to-rearrange gesture — both ends of it, since a pane
 * is equally the thing being carried and the thing being dropped on.
 */
function PaneLeaf({
  id,
  isOnlyPane,
  isFocused,
  onFocus,
  onSplit,
  onClose,
  onMovePane,
}: PaneLeafProps): ReactNode {
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null);
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
    setDropEdge(null);
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
        setDropEdge(edgeAt(e));
      }}
      onDragLeave={(e) => {
        if (pointerLeft(e)) endHover();
      }}
      onDrop={(e) => {
        const source = e.dataTransfer.getData(TERMINAL_PANE_MIME);
        e.preventDefault();
        e.stopPropagation();
        // Re-read the edge from the drop itself rather than trusting the hover
        // state, which is a render behind a fast gesture.
        const edge = edgeAt(e);
        endHover();
        // The drop may unmount the grip that started the drag, and a `dragend`
        // is not guaranteed once that happens — so the drag is ended here
        // rather than left for the element that is about to disappear.
        setDraggedPane(null);
        if (source) onMovePane(source, id, edge);
      }}
    >
      <div className="relative min-h-0 flex-1">
        <TerminalPane id={id} active={isFocused} />
        {/* Focus reads as the pane that isn't faded, rather than a border
            drawn around it — one less line inside an already busy panel.
            This is a veil of the terminal's own background rather than
            `opacity` on the pane: fading the element composites its text
            against the app chrome behind it, which tints the output and
            washes it out, while a veil settles it toward the background it
            already sits on. Reads as "still a terminal, just not this one".
            Non-interactive, so a click still focuses the pane underneath. */}
        {!isFocused && !isOnlyPane && (
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

      {/* Hover affordances — move / split / close. */}
      <div
        className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5
                   rounded-md bg-surface-raised/90 p-0.5 opacity-0
                   transition-opacity group-hover/pane:opacity-100"
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
        <PaneButton label="Split right" onClick={() => onSplit(id, "row")}>
          <SplitRightIcon />
        </PaneButton>
        <PaneButton label="Split down" onClick={() => onSplit(id, "column")}>
          <SplitDownIcon />
        </PaneButton>
        <PaneButton label="Close pane" onClick={() => onClose(id)}>
          <span className="text-sm leading-none">×</span>
        </PaneButton>
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

/** The small square icon button used by every terminal-chrome control. */
export function PaneButton({
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

function SplitRightIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <line x1="8" y1="2.5" x2="8" y2="13.5" />
    </svg>
  );
}

function SplitDownIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  );
}
