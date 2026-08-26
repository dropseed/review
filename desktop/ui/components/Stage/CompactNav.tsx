import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import { useIsCompact } from "../../hooks/useIsCompact";

/**
 * Opening the workspace queue, from wherever the phone happens to be.
 *
 * A context rather than a prop, because the button that opens it lives on the
 * two half headers — `TerminalPanel`'s tab strip and `Stage/CodeHalfHeader` —
 * and neither is anywhere near the shell that owns the drawer. Threading a
 * callback down to both would put a phone-only parameter on the signature of
 * two components that otherwise know nothing about viewport width.
 *
 * `openQueue` is a no-op at desktop width, where nothing calls it: the queue is
 * a column you can already see.
 */
const CompactNavContext = createContext<{
  queueOpen: boolean;
  openQueue: () => void;
  closeQueue: () => void;
}>({
  queueOpen: false,
  openQueue: () => {},
  closeQueue: () => {},
});

export function CompactNavProvider({
  children,
}: {
  children: (state: {
    queueOpen: boolean;
    closeQueue: () => void;
  }) => ReactNode;
}): ReactNode {
  // Deliberately *not* `tabRailCollapsed`: that one is persisted, and a phone
  // must not open into whatever a laptop last chose. It also has to start
  // closed on every load, which a persisted flag cannot promise.
  const [queueOpen, setQueueOpen] = useState(false);
  const openQueue = useCallback(() => setQueueOpen(true), []);
  const closeQueue = useCallback(() => setQueueOpen(false), []);

  return (
    <CompactNavContext.Provider value={{ queueOpen, openQueue, closeQueue }}>
      {children({ queueOpen, closeQueue })}
    </CompactNavContext.Provider>
  );
}

export function useCompactNav(): {
  queueOpen: boolean;
  openQueue: () => void;
  closeQueue: () => void;
} {
  return useContext(CompactNavContext);
}

/**
 * The phone's way into the workspace queue: a hamburger on the header of
 * whichever half is on screen.
 *
 * On the header rather than in a bottom bar, because "which workspace am I in"
 * is a different kind of question from "which half of this workspace am I
 * looking at". The bottom bar switches between two views of the thing you are
 * already in; this leaves it. Putting all three in one row of tabs said they
 * were siblings, and made the queue — the app's entire navigation — look like a
 * third pane.
 *
 * Renders nothing at desktop width, where the queue is a column already on
 * screen and this would be a second way to ask for it.
 */
export function CompactMenuButton(): ReactNode {
  const compact = useIsCompact();
  const { openQueue } = useCompactNav();

  if (!compact) return null;

  return (
    <button
      type="button"
      onClick={openQueue}
      aria-label="Workspaces"
      // Drawn at 36px because that is the height of the row it sits in, but hit
      // at 44 — `tap-target` spills the extra as invisible slop rather than
      // pushing the tabs beside it over. `tap` is the press state. See index.css.
      className="tap tap-target -ml-0.5 flex size-9 shrink-0 items-center
                 justify-center rounded-md text-fg-muted active:bg-surface-raised"
    >
      <svg
        className="size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}
