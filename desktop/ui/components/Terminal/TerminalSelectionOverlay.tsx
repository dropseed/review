import { type ReactNode, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { normalizeCopyText, wordRangeAt } from "./selection-text";

/**
 * Where the terminal's drawing sits inside its pane, and at what scale — the
 * numbers the overlay has to land on exactly.
 *
 * `width`/`height` are the grid's *natural* size in its own pixels; `scale` is
 * the transform the pane draws it at. The overlay is built at the natural size
 * and scaled by the same number, so its rows and the canvas's rows are the same
 * boxes however far the pane is scaled down.
 */
export interface SelectionLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * How long after a touch inside the text to ask what it did to the selection.
 *
 * Long enough for a tap's own selection collapse and for a handle drag to have
 * started, short enough that a tap meant to dismiss doesn't feel stuck.
 */
const SETTLE_MS = 250;

/** The type the terminal is drawn in, so the overlay is drawn in it too. */
export interface SelectionFont {
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
}

/**
 * Native text selection over a terminal.
 *
 * xterm draws into a WebGL canvas, and a canvas has no text in it: iOS's
 * handles, magnifier and Copy/Share menu — the whole apparatus a phone selects
 * text with — have nothing to grab. Below scale 1 xterm's own mouse-driven
 * selection is wrong as well, since it divides a scaled bounding rect by
 * unscaled cell metrics. A native app gets all of this for free; this is what
 * it costs to have it here.
 *
 * So: a long press mounts a DOM copy of exactly what is on screen, one
 * absolutely-sized block per row, positioned and scaled onto the drawing it
 * hides. It is *text*, so everything the phone knows how to do with text works
 * — and it is a **snapshot**, deliberately, because handles dragged across a
 * screen that is still repainting select something other than what was aimed
 * at. The pane refreshes it only while nothing is selected.
 *
 * Colours stop at foreground-on-background. Per-cell colour would mean a span
 * per run and a serialization full of boundaries, to restate something the
 * canvas underneath already said; what this surface is for is the characters.
 */
export function TerminalSelectionOverlay({
  rows,
  at,
  layout,
  font,
  onExit,
}: {
  /** The visible screen, one string per row (see `snapshotRows`). */
  rows: string[];
  /** The cell the press landed on, whose word is selected on arrival. */
  at: { row: number; col: number } | null;
  layout: SelectionLayout;
  font: SelectionFont;
  onExit: () => void;
}): ReactNode {
  const textRef = useRef<HTMLDivElement>(null);
  /** Whether the arrival selection has been made — once per press, not per row
   *  refresh, which would drag the handles back to the pressed word. */
  const seeded = useRef(false);

  const rowHeight = layout.height / Math.max(1, rows.length);

  // The one thing a phone can't be told any other way. A long press on a
  // native app answers with a tap of haptics; the web has none to give here
  // (`navigator.vibrate` is Android-only, and iOS Safari does not implement
  // it), so the mode announces itself by flashing the pane's edge — a beat
  // long, then gone, because it is an acknowledgement and not a state.
  const [flash, setFlash] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setFlash(false), 240);
    return () => clearTimeout(timer);
  }, []);

  // Select the pressed word straight away, the way a long press in Notes or
  // Messages does: the handles and the callout have to be *there* when the
  // finger lifts, or the gesture reads as having done nothing.
  //
  // Nothing here undoes itself on cleanup, deliberately. The selection lives
  // in nodes this component owns, so unmounting takes it (and the handles)
  // away on its own — while a cleanup that cleared it by hand would, under
  // StrictMode's mount-cleanup-mount, wipe the selection this effect had just
  // made and then decline to make it again.
  useEffect(() => {
    if (seeded.current || !at) return;
    seeded.current = true;
    const host = textRef.current;
    const rowEl = host?.children[at.row] as HTMLElement | undefined;
    const node = rowEl?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const range = wordRangeAt(rows[at.row] ?? "", at.col);
    if (!range) return;
    const length = node.textContent?.length ?? 0;
    try {
      // Take focus off xterm's hidden textarea first. A document selection
      // cannot be held while a text field owns the caret — the range is
      // dropped the moment it is added — and on a phone this also puts the
      // software keyboard away, which is the half of the screen the text
      // being read was under.
      host?.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (!selection) return;
      const domRange = document.createRange();
      domRange.setStart(node, Math.min(range.start, length));
      domRange.setEnd(node, Math.min(range.end, length));
      selection.removeAllRanges();
      selection.addRange(domRange);
    } catch {
      // jsdom, and any engine that declines a programmatic selection: the
      // overlay is still selectable by hand, which is the point of it.
    }
  }, [at, rows]);

  // Leaving, and the one event it is decided by.
  //
  // Every exit is a touch: outside the text — the key bar, the compose box,
  // the tab strip — it leaves at once, and inside the text it leaves only if
  // the touch put the selection *down*, which is what a tap in a selection
  // does on iOS and what dragging a handle deliberately does not. Watched on
  // the document rather than on a backdrop of our own because the chrome it
  // covers cancels its own pointerdown to keep the keyboard up, so a listener
  // waiting for focus to move would never hear it.
  //
  // Losing the selection is deliberately *not* an exit on its own: xterm
  // refocuses its hidden textarea whenever the terminal underneath is
  // redrawn, and a focus move collapses the document selection — so a rule
  // written on `selectionchange` closed the overlay by itself, at the mercy of
  // whatever the program happened to print.
  useEffect(() => {
    const inside = (node: Node | null): boolean =>
      !!node && !!textRef.current && textRef.current.contains(node);

    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target as Node)) {
        onExit();
        return;
      }
      // A tap lands before the browser has decided what it did to the
      // selection, so the answer is read on the other side of the gesture.
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (
          !selection ||
          selection.isCollapsed ||
          !inside(selection.anchorNode)
        )
          onExit();
      }, SETTLE_MS);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onExit]);

  return (
    <div
      data-terminal-selection
      className={clsx(
        "absolute inset-0 z-20 transition-shadow duration-300",
        flash && "ring-2 ring-inset ring-focus-ring",
      )}
      // The pane focuses its shell on mousedown, which on iOS raises the
      // keyboard — over the text being selected, and taking the selection
      // with it. Not prevented, only stopped: preventing it here would cancel
      // the browser's own selection handling, which is the whole feature.
      onMouseDown={(e) => e.stopPropagation()}
      onCopy={(e) => {
        const text = normalizeCopyText(window.getSelection()?.toString() ?? "");
        if (!text) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", text);
      }}
    >
      <div
        ref={textRef}
        // Focusable so the caret can be taken off the terminal's textarea, but
        // not a tab stop: nothing here is reached by tabbing.
        tabIndex={-1}
        className="absolute touch-auto whitespace-pre bg-surface-inset text-fg
                   outline-none"
        style={{
          left: layout.left,
          top: layout.top,
          width: layout.width,
          height: layout.height,
          transform: `scale(${layout.scale})`,
          transformOrigin: "top left",
          fontFamily: font.fontFamily,
          fontSize: font.fontSize,
          letterSpacing: font.letterSpacing,
          // The three properties that are the whole point: text a finger can
          // take hold of, with the callout menu iOS suppresses by default in
          // an app-shaped page.
          userSelect: "text",
          WebkitUserSelect: "text",
          WebkitTouchCallout: "default",
        }}
      >
        {rows.map((row, i) => (
          <div
            // Rows are positions, not content — row 3 stays row 3 when what it
            // says changes, which is what keeps a held selection from jumping.
            key={i}
            style={{ height: rowHeight, lineHeight: `${rowHeight}px` }}
          >
            {/* An empty box serializes to nothing, so a selection dragged
                across a gap in the output comes back with the gap closed up.
                A no-break space is a line as far as the browser is concerned,
                and `normalizeCopyText` turns it back into the blank line the
                program actually printed. */}
            {row === "" ? "\u00a0" : row}
          </div>
        ))}
      </div>

      <button
        type="button"
        // Same bargain the key bar makes: no focus move, so the keyboard (and
        // the selection) stay where they are until this actually exits.
        //
        // It does not exit *here*: a press on this button is a press outside
        // the text, which the document listener above already reads as leaving.
        // Saying it twice would only be a second rule to keep in step.
        onPointerDown={(e) => e.preventDefault()}
        // Except by keyboard, which produces no pointer event for that rule to
        // catch — a `click` with no detail is the only exit this button owns.
        onClick={(e) => {
          if (e.detail === 0) onExit();
        }}
        className="tap absolute right-2 top-2 z-10 rounded-md
                   bg-surface-raised/90 px-2.5 py-1.5 text-xs text-fg-muted
                   shadow-sm"
      >
        Done
      </button>
    </div>
  );
}
