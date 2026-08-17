import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Spinner } from "./spinner";

/** Scroll offset restore captured just before a collapse removes content. */
export interface CollapseShift {
  scroller: HTMLElement;
  scrollTop: number;
  removedAbove: number;
}

/**
 * How much has already been taken off each scroller in the batch of collapses
 * currently being applied. Entries live for one commit and no longer — see
 * `applyCollapseShift`.
 */
const removedThisBatch = new Map<HTMLElement, number>();

/**
 * Put the scroll offset back after a collapse, accounting for every other item
 * collapsing alongside it.
 *
 * One approval action routinely collapses several files at once ("approve all"
 * on a guide group, a bulk select, a trust pattern, a CLI approve arriving via
 * the watcher). Each of those items measured the *same* pre-collapse offset,
 * so each writing `measured - its own removedAbove` means the last one to run
 * wins and the page lands short by everything the others removed. Summing the
 * removals across the batch is what makes the composed case come out where the
 * single case already did.
 *
 * The running total is dropped in a microtask: layout effects for a commit all
 * run in one synchronous block, so the microtask is guaranteed to land after
 * the last of them and before any later collapse measures a fresh offset.
 */
export function applyCollapseShift(shift: CollapseShift): void {
  const { scroller, scrollTop, removedAbove } = shift;
  const previous = removedThisBatch.get(scroller);
  if (previous === undefined)
    queueMicrotask(() => removedThisBatch.delete(scroller));
  const removed = (previous ?? 0) + removedAbove;
  removedThisBatch.set(scroller, removed);
  scroller.scrollTop = scrollTop - removed;
}

/** Nearest scrollable ancestor, or null if nothing above this element scrolls. */
export function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * How far the scroll offset must move to keep the viewport visually still once
 * `content` is unmounted. Only the slice of it sitting above the scroll
 * container's top edge counts — content collapsing below the fold pulls the
 * page up under nothing the reader is looking at, so it needs no adjustment.
 */
function measureCollapseShift(
  content: HTMLElement | null,
): CollapseShift | null {
  if (!content) return null;
  const scroller = findScrollParent(content);
  if (!scroller) return null;
  const contentRect = content.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const removedAbove = Math.max(
    0,
    Math.min(scrollerRect.top - contentRect.top, contentRect.height),
  );
  if (removedAbove === 0) return null;
  return { scroller, scrollTop: scroller.scrollTop, removedAbove };
}

interface FileDiffStackItemProps {
  filePath: string;
  isLoading: boolean;
  /** Right-side header content (action buttons, status indicator). */
  headerActions?: ReactNode;
  /** When this prop transitions false → true, the item auto-collapses. */
  autoCollapseSignal?: boolean;
  /** Opens the file in the single-file viewer. */
  onViewFile: () => void;
  children: ReactNode;
}

/**
 * One file's section in a vertically stacked multi-file diff view. Provides
 * a sticky path header with a collapse caret, a "view full file" link, an
 * optional spinner while loading, and an optional auto-collapse-on-complete
 * signal for guided review flows.
 */
export function FileDiffStackItem({
  filePath,
  isLoading,
  headerActions,
  autoCollapseSignal,
  onViewFile,
  children,
}: FileDiffStackItemProps): ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingShiftRef = useRef<CollapseShift | null>(null);

  const prevAutoCollapse = useRef(false);
  useEffect(() => {
    if (autoCollapseSignal && !prevAutoCollapse.current) {
      // Measured here, before the state change unmounts the diff.
      pendingShiftRef.current = measureCollapseShift(contentRef.current);
      setIsCollapsed(true);
    }
    prevAutoCollapse.current = autoCollapseSignal ?? false;
  }, [autoCollapseSignal]);

  // Auto-collapse is a progress signal, not a navigation, so it must not move
  // what the reader is looking at. The webview has no scroll anchoring to fall
  // back on, so re-apply the offset by hand once the content is gone. Absolute
  // assignment (not a relative nudge) so it survives the browser's own clamp
  // when the shrunken content no longer reaches the previous offset.
  useLayoutEffect(() => {
    const shift = pendingShiftRef.current;
    if (!shift || !isCollapsed) return;
    pendingShiftRef.current = null;
    applyCollapseShift(shift);
  }, [isCollapsed]);

  return (
    <div className="border-b border-edge/50">
      <div className="sticky top-[72px] z-[9] bg-surface-panel/95 backdrop-blur-sm flex items-center gap-2 px-4 py-1.5 border-b border-edge/30">
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="shrink-0 text-fg-muted hover:text-fg-secondary transition-colors"
          aria-label={isCollapsed ? "Expand file" : "Collapse file"}
        >
          <svg
            className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="font-mono text-xs text-fg-muted flex-1 truncate text-left hover:text-fg-secondary transition-colors"
        >
          {filePath}
        </button>
        <button
          type="button"
          onClick={onViewFile}
          className="shrink-0 text-fg-muted hover:text-fg-secondary transition-colors p-0.5 rounded hover:bg-surface-hover"
          title="View full file"
          aria-label="View full file"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
          </svg>
        </button>
        {headerActions}
      </div>

      {!isCollapsed && (
        <div ref={contentRef}>
          {isLoading && (
            <div className="flex items-center gap-2 px-4 py-6 text-fg-muted">
              <Spinner className="h-4 w-4" />
              <span className="text-xs">Loading diff...</span>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
