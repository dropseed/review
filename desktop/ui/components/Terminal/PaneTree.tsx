import { type ReactNode, Fragment, useRef } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import type { PaneNode, SplitDirection } from "./pane-tree";
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
}

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
}: PaneTreeProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeSplit = useReviewStore((s) => s.resizeSplit);

  if (node.type === "leaf") {
    const id = node.terminalId;
    const isFocused = tabActive && id === focusedId;
    // A leaf at the tab root is the only pane, so there's nothing to contrast
    // it against — dimming it would just make the whole panel look asleep.
    const isOnlyPane = path.length === 0;
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
          // Focus reads as the pane that isn't faded, rather than a border
          // drawn around it — one less line inside an already busy panel.
          // Kept shallow so the dimmed pane's output stays readable.
          "transition-opacity",
          !isFocused && !isOnlyPane && "opacity-70",
        )}
        onMouseDown={() => onFocus(id)}
      >
        <div className="relative min-h-0 flex-1">
          <TerminalPane id={id} active={isFocused} />
        </div>

        {/* Hover affordances — split / close. */}
        <div
          className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5
                     rounded-md bg-surface-raised/90 p-0.5 opacity-0
                     transition-opacity group-hover/pane:opacity-100"
        >
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
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

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
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-faint
                 transition-colors hover:bg-fg/[0.08] hover:text-fg-secondary"
    >
      {children}
    </button>
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
