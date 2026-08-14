import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { ResizeHandle } from "../ContentArea/ResizeHandle";
import { DiffRail } from "../ContentArea/DiffRail";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalRail } from "./TerminalRail";
import {
  TERMINAL_MAX_CONTENT_FRACTION,
  clampPanelWidthPx,
  rafThrottle,
  toggleToCanonical,
} from "../../utils/resize";
import {
  TERMINAL_PANEL_WIDTH_MAX,
  TERMINAL_PANEL_WIDTH_MIN,
} from "../../stores/slices/terminalSlice";
import { useTerminalDockPresent } from "../../stores/selectors/terminals";

/**
 * The terminal's place in the window: a resizable pane docked left or right of
 * whatever the app is showing, with that content as `children`.
 *
 * Mounted at the app shell rather than inside the review screen, because tabs
 * are global — a shell you started is still yours on the home screen, and a
 * panel that unmounted with the route would take every xterm with it.
 *
 * The dock therefore owns the gutter between the two: a terminal pane drops its
 * padding on the side facing the content, so the two cards share one gutter
 * instead of stacking theirs. Content keeps its own padding and never has to
 * know which side the terminal is on — or whether it is there at all.
 */
export function TerminalDock({ children }: { children: ReactNode }): ReactNode {
  const contentFocus = useReviewStore((s) => s.contentFocus);
  const terminalPanelWidth = useReviewStore((s) => s.terminalPanelWidth);
  const setTerminalPanelWidth = useReviewStore((s) => s.setTerminalPanelWidth);
  const terminalDockSide = useReviewStore((s) => s.terminalDockSide);
  const contentRowRef = useRef<HTMLDivElement | null>(null);

  // A workspace showing a repo keeps its dock whether or not it is running
  // anything — the strip's own "+" is how a shell gets started in it.
  const docked = useTerminalDockPresent();
  const focus = docked ? contentFocus : "code";
  const terminalFocused = focus === "terminal";
  // Focusing the code still leaves the terminal on its dock edge — as a
  // narrow rail, not nothing, so there's a way back besides remembering ⌘`.
  const railed = docked && focus === "code";
  const dockLeft = docked && terminalDockSide === "left";
  const dockRight = docked && terminalDockSide === "right";

  // ResizeHandle reports a fraction of the content row from its left edge. The
  // width is always the terminal pane's own width, measured from whichever side
  // it's docked on — so a right dock measures from the right edge (1 - fraction).
  const handleTerminalResize = useCallback(
    (fraction: number) => {
      const rowWidth = contentRowRef.current?.clientWidth ?? 0;
      if (rowWidth === 0) return;
      const sideFraction =
        terminalDockSide === "right" ? 1 - fraction : fraction;
      setTerminalPanelWidth(Math.round(sideFraction * rowWidth));
    },
    [setTerminalPanelWidth, terminalDockSide],
  );

  // The panel's stored width is px, and a width picked on an ultrawide is most
  // of a laptop screen. Rather than rewrite the stored width — which would lose
  // it the moment you unplugged — the row is measured and the panel is capped
  // at a share of it, so it comes back at full size on the display it was
  // sized for.
  const [contentRowWidth, setContentRowWidth] = useState(0);
  useEffect(() => {
    const row = contentRowRef.current;
    if (!row) return;
    const update = rafThrottle(setContentRowWidth);
    const observer = new ResizeObserver((entries) => {
      update(entries[0].contentRect.width);
    });
    observer.observe(row);
    setContentRowWidth(row.clientWidth);
    return () => {
      observer.disconnect();
      update.cancel();
    };
  }, []);
  const appliedTerminalWidth = clampPanelWidthPx(
    terminalPanelWidth,
    contentRowWidth,
    TERMINAL_MAX_CONTENT_FRACTION,
  );

  // Double-click on the divider splits the content region evenly between the
  // terminal and the content, and double-clicking again gives the panel its old
  // width back.
  const rememberedTerminalWidth = useRef<number | null>(null);
  const handleTerminalReset = useCallback(() => {
    const rowWidth = contentRowRef.current?.clientWidth ?? 0;
    if (rowWidth === 0) return;
    // Held inside the panel's own bounds so "even" is a width the panel can
    // actually take — otherwise the toggle would never register as reached.
    const even = Math.max(
      TERMINAL_PANEL_WIDTH_MIN,
      Math.min(TERMINAL_PANEL_WIDTH_MAX, Math.round(rowWidth / 2)),
    );
    const { next, remember } = toggleToCanonical(
      useReviewStore.getState().terminalPanelWidth,
      even,
      rememberedTerminalWidth.current,
      even,
      1,
    );
    rememberedTerminalWidth.current = remember;
    setTerminalPanelWidth(Math.round(next));
  }, [setTerminalPanelWidth]);

  // Cmd+` and Cmd+Shift+Enter are the `view.toggleTerminal` and
  // `view.maximizeTerminal` commands. A second window listener here would not
  // replace the dispatcher's — preventDefault does not stop a sibling listener
  // on the same target — so both would fire and the toggle would cancel itself.

  // Padding on the side the content is on is dropped throughout: whichever
  // shape the terminal takes, the gutter between it and the content is the
  // content's own.
  const facing = terminalDockSide === "left" ? "pr-0" : "pl-0";
  const terminalPane = !docked ? null : railed ? (
    <div className={clsx("w-12 shrink-0 overflow-hidden p-2", facing)}>
      <TerminalRail />
    </div>
  ) : (
    <div
      className={clsx(
        "overflow-hidden p-2",
        facing,
        terminalFocused ? "min-w-0 flex-1" : "shrink-0",
      )}
      style={terminalFocused ? undefined : { width: appliedTerminalWidth }}
    >
      <TerminalPanel />
    </div>
  );

  // The rail is fixed-width — nothing to drag.
  const terminalResize =
    docked && !railed && !terminalFocused ? (
      <ResizeHandle
        orientation="horizontal"
        onResize={handleTerminalResize}
        onReset={handleTerminalReset}
      />
    ) : null;

  // Terminal focused: it takes the content region, and what it covered
  // collapses to its own rail on the far edge — the same rule in reverse, so
  // neither side can ever vanish without a trace. The content stays mounted
  // behind it (hidden, so it takes no space): a focused terminal must not
  // stop the review's watchers or throw away where it was scrolled to.
  const contentRail = terminalFocused ? (
    <div className="w-12 shrink-0 overflow-hidden p-2">
      <DiffRail />
    </div>
  ) : null;

  const content = (
    <div
      className={clsx(
        "flex min-w-0 flex-1 flex-col overflow-hidden",
        terminalFocused && "hidden",
      )}
    >
      {children}
    </div>
  );

  return (
    <div
      ref={contentRowRef}
      className="relative flex flex-1 flex-row overflow-hidden bg-surface"
    >
      {dockLeft && (
        <>
          {terminalPane}
          {terminalResize}
          {contentRail}
        </>
      )}
      {content}
      {dockRight && (
        <>
          {contentRail}
          {terminalResize}
          {terminalPane}
        </>
      )}
    </div>
  );
}
