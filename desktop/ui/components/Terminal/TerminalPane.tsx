import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Terminal } from "@xterm/xterm";
import { getApiClient } from "../../api";
import { useReviewStore } from "../../stores";
import { useIsCompact } from "../../hooks/useIsCompact";
import { useIsTouchPrimary } from "../../hooks/useIsTouchPrimary";
import {
  MAX_KEYS_PER_DRAG_EVENT,
  acquireTerminal,
  attachRenderer,
  beginTerminalReplay,
  cellWidth,
  endDrag,
  onTerminalGrid,
  openLinkAt,
  previewFontSize,
  requestFit,
  scrollByDrag,
  sendChar,
  sendKey,
  setFitAction,
  seedTerminalGridSize,
  setTerminalMountPolicy,
  setTerminalRemoteClaim,
  startTerminalOutput,
  takeSteps,
  terminalGridSize,
  terminalRemoteClaim,
  terminalReplayInFlight,
} from "./registry";
import { buildXtermTheme } from "./xterm-theme";
import {
  TERMINAL_FONT_SIZE_STEP,
  TERMINAL_FONT_WEIGHT_BOLD,
} from "../../stores/slices/preferencesSlice";
import {
  applyTerminalFontSize,
  clampTerminalFontSize,
} from "./TerminalTextSize";
import {
  type GestureAxis,
  lockAxis,
  pinchSteps,
  touchDistance,
} from "./touch-gestures";
import { createLongPress } from "./long-press";
import { snapshotRows } from "./selection-text";
import {
  type SelectionLayout,
  TerminalSelectionOverlay,
} from "./TerminalSelectionOverlay";
import { decodeBase64 } from "./base64";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

interface TerminalPaneProps {
  id: string;
  /** Whether this pane's tab is the visible one. Panes stay mounted when
   *  inactive (hidden) so their xterm keeps streaming. */
  active: boolean;
  /**
   * Render the PTY at its true grid, scaled to fit the container, and never
   * resize it. Looking at a terminal must not change it: the overview passes
   * this so opening it stops reflowing every session to column width, and
   * phone width (compact) implies it so glancing at the PWA leaves the
   * desktop's layout alone.
   */
  viewer?: boolean;
}

const RESIZE_DEBOUNCE_MS = 50;

/**
 * How far a finger travels before the gesture is a drag rather than a tap —
 * and, in the same moment, which axis that drag committed to.
 *
 * Below it nothing moves and nothing is cancelled, so the tap that focuses
 * the shell (and raises the keyboard) still lands with the small movement any
 * real thumb makes.
 */
const TOUCH_SLOP_PX = 6;

/**
 * How long the live-output transport may be down before the pane admits it.
 *
 * A terminal that has lost its socket looks exactly like a terminal with
 * nothing to say, and on a phone that has just been unlocked those are the two
 * likeliest states — so the notice is the difference. It is deliberately only
 * that: no retry button, since the socket is already dialling (see
 * `TerminalSocket.wake`), and nothing at all in the healthy case. A session
 * that has *exited* says nothing here either; the pane's own exit handling
 * reports that, and two notices for one fact is one too many.
 */
const RECONNECT_GRACE_MS = 700;

interface GridSize {
  cols: number;
  rows: number;
}

/**
 * Renders a single terminal session into a kept-alive xterm instance. The
 * instance lives in the module registry (see registry.ts), so unmounting this
 * pane detaches the DOM but preserves the buffer — remounting re-attaches with
 * no flicker. Raw PTY output flows transport → xterm directly, never through
 * the store.
 *
 * The PTY has exactly one grid, shared by every client, so a pane is either
 * its **owner** — fitting the grid to this container and resizing the PTY on
 * container changes, today's desktop behavior — or a **viewer**, which renders
 * the grid at its true size scaled down to fit and never resizes. An owner
 * whose grid is claimed by another client (a phone tapping "Fit to screen")
 * letterboxes at the remote size and wears a badge until the user interacts
 * here, which fits the grid back — size follows deliberate use, never a
 * glance.
 */
export function TerminalPane({
  id,
  active,
  viewer = false,
}: TerminalPaneProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const compact = useIsCompact();
  // Selecting is gated on the device rather than the width, like the key bar
  // and for the same reason: a canvas has no selection handles on any
  // touchscreen, and an iPad in landscape is wide and still has only fingers.
  const touchPrimary = useIsTouchPrimary();
  const touchPrimaryRef = useRef(touchPrimary);
  touchPrimaryRef.current = touchPrimary;
  // Compact degrades to a viewer and writes nothing back — a phone visit must
  // not reflow the session out from under a desktop that is still sized to it.
  const isViewer = viewer || compact;
  const fontFamily = useReviewStore((s) => s.terminalFontFamily);
  const fontSize = useReviewStore((s) => s.terminalFontSize);
  const fontWeight = useReviewStore((s) => s.terminalFontWeight);
  const lineHeight = useReviewStore((s) => s.terminalLineHeight);
  const letterSpacing = useReviewStore((s) => s.terminalLetterSpacing);

  /** Owner only: the grid another client claimed, or null when this pane's. */
  const [remoteSize, setRemoteSize] = useState<GridSize | null>(null);
  const remoteSizeRef = useRef<GridSize | null>(null);
  /**
   * Where the drawing sits in this pane and what it is scaled by — null until
   * the first layout. One answer for two readers: the "Fit to screen" button
   * appears only below scale 1, and the selection overlay has to be positioned
   * on exactly these numbers rather than measuring the canvas a second time.
   */
  const [layout, setLayout] = useState<SelectionLayout | null>(null);
  const viewScale = layout?.scale ?? 1;
  /** The same scale, readable from the touch handlers without re-binding
   *  them every time the drawing rescales. */
  const scaleRef = useRef(1);
  /**
   * Select mode: the frozen screen a long press put on top of the terminal,
   * and the cell it was pressed on. Null the rest of the time, which is nearly
   * always — see TerminalSelectionOverlay.
   */
  const [selecting, setSelecting] = useState<{
    rows: string[];
    at: { row: number; col: number } | null;
  } | null>(null);
  const exitSelect = useCallback(() => setSelecting(null), []);
  /** Owner reclaim (fit + resize), reachable from render handlers. */
  const reclaimRef = useRef<(() => void) | null>(null);
  /** Whether this client's live-output transport is currently down, and
   *  whether it has been down long enough to be worth saying so. */
  const [reconnecting, setReconnecting] = useState(false);
  const [showReconnecting, setShowReconnecting] = useState(false);

  // Keep the latest options in refs so the setup effect (keyed only on id and
  // mode) reads current values without re-running and re-opening the terminal.
  // Live changes are pushed to open terminals by the preferencesSlice setters.
  const optionsRef = useRef({
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
  });
  optionsRef.current = {
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const client = getApiClient();

    // A fresh mount (or a mode flip re-running this effect) starts unclaimed.
    remoteSizeRef.current = null;
    setRemoteSize(null);
    scaleRef.current = 1;
    setLayout(null);
    setSelecting(null);

    // Consume the "fresh" flag before acquiring — a freshly created session has
    // no scrollback to replay.
    const wasFresh = useReviewStore.getState().freshTerminalIds.includes(id);
    if (wasFresh) useReviewStore.getState().consumeFreshTerminal(id);

    const opts = optionsRef.current;
    const { term, fit, isNew } = acquireTerminal(id, {
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      fontWeight: opts.fontWeight,
      fontWeightBold: TERMINAL_FONT_WEIGHT_BOLD,
      lineHeight: opts.lineHeight,
      letterSpacing: opts.letterSpacing,
      theme: buildXtermTheme(),
    });
    termRef.current = term;
    setTerminalMountPolicy(id, isViewer ? "viewer" : "owner");

    // Attach (or re-attach) the terminal's DOM element into our container.
    if (term.element && term.element.parentElement !== container) {
      container.appendChild(term.element);
      // Moving the element can drop the GPU renderer's last frame (WebGL does
      // not preserve its drawing buffer). An owner used to heal incidentally —
      // its fit resized the grid, forcing a repaint — but resizes are no-ops
      // now when nothing changed, so ask for the repaint outright.
      try {
        term.refresh(0, term.rows - 1);
      } catch {
        /* renderer not attached yet */
      }
    } else if (!term.element) {
      term.open(container);
    }
    // The GPU renderer binds to the opened element, so this has to follow
    // open()/re-attach.
    attachRenderer(id);

    // ----- Layout: one grid, drawn at scale or fitted -----

    /** Publish the drawing's box, for the two readers that need it. */
    const publishLayout = (next: SelectionLayout | null) => {
      setLayout((cur) => (sameLayout(cur, next) ? cur : next));
    };

    /**
     * The unscaled case: the drawing is wherever normal flow put it. Measured
     * rather than derived, because that is the only way to ask — and only on
     * the paths that just laid the terminal out, never per frame.
     */
    const publishFlowLayout = () => {
      const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!screen?.offsetWidth || !screen.offsetHeight) {
        publishLayout(null);
        return;
      }
      const box = screen.getBoundingClientRect();
      const host = container.getBoundingClientRect();
      publishLayout({
        left: box.left - host.left,
        top: box.top - host.top,
        width: screen.offsetWidth,
        height: screen.offsetHeight,
        scale: 1,
      });
    };

    /**
     * Draw the grid at its true size, scaled down (never up) to fit the
     * container and centered. The element gets its natural size explicitly so
     * xterm's own absolutely-positioned internals (viewport, selection) keep
     * agreeing with the screen; the transform is purely visual.
     *
     * Known limit: below scale 1, xterm's own mouse math divides the scaled
     * bounding rect by unscaled cell sizes, so click-to-select and
     * mouse-reporting land cells off. Scaled panes are glance surfaces —
     * reading and typing are exact; precise mouse work happens at scale 1.
     * Selecting text is the exception, and the reason the numbers below are
     * published rather than kept: a long press draws its own DOM text at
     * exactly this box, which is right at any scale (see `selecting`).
     */
    const applyScaledLayout = () => {
      const el = term.element;
      if (!el) return;
      const screen = el.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return;
      const w = screen.offsetWidth;
      const h = screen.offsetHeight;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (!w || !h || !cw || !ch) return;
      const s = Math.min(1, cw / w, ch / h);
      const left = Math.max(0, (cw - w * s) / 2);
      const top = Math.max(0, (ch - h * s) / 2);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transformOrigin = "top left";
      el.style.transform = `translate(${left}px, ${top}px) scale(${s})`;
      // Nothing here changed the grid, so xterm doesn't know to repaint — but
      // the pane may have just become visible (compact navigation re-parents
      // it), and a renderer that skipped painting while hidden stays blank
      // until told otherwise.
      try {
        term.refresh(0, term.rows - 1);
      } catch {
        /* disposed mid-layout */
      }
      scaleRef.current = s;
      publishLayout({ left, top, width: w, height: h, scale: s });
    };

    /** Back to normal flow — the element is the container's again. */
    const clearScaledLayout = () => {
      scaleRef.current = 1;
      const el = term.element;
      if (!el) return;
      el.style.width = "";
      el.style.height = "";
      el.style.transform = "";
      el.style.transformOrigin = "";
      publishFlowLayout();
    };

    const scheduleScaledLayout = () => requestAnimationFrame(applyScaledLayout);

    /** Match the local xterm grid to the PTY's. Rendering raw PTY bytes at any
     *  other width draws garbage, not a smaller screen. */
    const regrid = ({ cols, rows }: GridSize) => {
      if (term.cols === cols && term.rows === rows) return;
      // A reflowed buffer is a different screen, and the snapshot lying on top
      // of it is of the old one — its rows no longer line up with anything.
      setSelecting(null);
      term.resize(cols, rows);
    };

    /** The size this pane last asked the PTY for — how its own confirmation
     *  is told apart from another client's resize. */
    let lastSent: GridSize | null = null;

    /** Owner: fit the grid to this container and tell the PTY. Also how an
     *  owner reclaims a grid another client resized. */
    const doFit = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      if (remoteSizeRef.current) {
        remoteSizeRef.current = null;
        setRemoteSize(null);
        setTerminalRemoteClaim(id, null);
      }
      clearScaledLayout();
      try {
        fit.fit();
      } catch {
        return;
      }
      lastSent = { cols: term.cols, rows: term.rows };
      publishFlowLayout();
      client
        .terminalResize(id, term.cols, term.rows)
        .catch((err) => console.error("[terminal] Resize failed:", err));
    };
    reclaimRef.current = doFit;

    // Compact's one deliberate resize: fit the shared grid to this screen —
    // then resume drawing as a viewer. Everything else a viewer does is
    // read-only toward the PTY. Published on the registry entry rather than
    // held here, because the panel's text-size stepper asks for the same
    // resize from outside this pane.
    setFitAction(id, () => {
      doFit();
      scheduleScaledLayout();
    });

    // Initial layout. A viewer starts at the PTY's true grid (seeded from the
    // session listing until the first resized event); an owner fits — unless
    // another client's claim is on record, which a remount must not undo:
    // reappearing (⌘` toggles, workspace switches) is a glance, and only a
    // click or keystroke here reclaims.
    if (isViewer) {
      const session = useReviewStore.getState().terminalSessions[id];
      if (session) {
        seedTerminalGridSize(id, { cols: session.cols, rows: session.rows });
      }
      const grid = terminalGridSize(id);
      if (grid) regrid(grid);
      scheduleScaledLayout();
    } else {
      const claim = terminalRemoteClaim(id);
      if (claim) {
        remoteSizeRef.current = claim;
        setRemoteSize(claim);
        regrid(claim);
        scheduleScaledLayout();
      } else {
        // The element may arrive wearing a viewer's transform (the overview
        // and the panel trade the same instance back and forth).
        clearScaledLayout();
      }
    }

    // Output is subscribed by the registry for the instance's whole life, not
    // this mount's — see registry.ts. All that's left here is deciding whether
    // a brand-new instance needs its scrollback replayed before the buffered
    // live output is released.
    if (isNew && !wasFresh) {
      // Cold reattach (new window / web reload): replay the ring buffer.
      beginTerminalReplay(id);
      client
        .terminalReplay(id)
        .then(({ dataB64, cursor, status }) => {
          startTerminalOutput(
            id,
            dataB64 ? { data: decodeBase64(dataB64), cursor } : undefined,
          );
          useReviewStore.getState().applyTerminalStatus(status);
        })
        .catch((err) => {
          console.error("[terminal] Replay failed:", err);
          startTerminalOutput(id);
        });
    } else if (!terminalReplayInFlight(id)) {
      // A remount inside a replay round trip must not release the held-back
      // output itself — that would null the buffer and drop the replay when it
      // arrives. The fetch it interrupted finishes the job.
      startTerminalOutput(id);
    }

    // Send keystrokes to the PTY. Typing is size-independent — a viewer can
    // answer a prompt without reflowing anything — but an owner typing into a
    // remotely-claimed grid is using the terminal *here*, which reclaims it.
    const onDataDisposable = term.onData((data) => {
      if (!isViewer && remoteSizeRef.current) doFit();
      // Through `sendChar` because the phone's key bar arms Control rather than
      // sending anything of its own, and this is one of the two places the
      // keystroke it modifies can arrive (see soft-keys.ts).
      sendChar(id, data);
    });

    // The daemon's answer to "what size is the grid": every client's resizes
    // arrive here, this pane's own included.
    const unsubGrid = onTerminalGrid(id, (size, seed) => {
      if (isViewer) {
        regrid(size);
        scheduleScaledLayout();
        return;
      }
      const claimed = remoteSizeRef.current !== null;
      // The stream's opening announcement isn't anyone changing the grid; an
      // unclaimed owner's own fit is authoritative over it.
      if (seed && !claimed) return;
      if (
        lastSent &&
        size.cols === lastSent.cols &&
        size.rows === lastSent.rows
      ) {
        // Our own fit confirmed.
        if (claimed) {
          remoteSizeRef.current = null;
          setRemoteSize(null);
          setTerminalRemoteClaim(id, null);
          clearScaledLayout();
        }
        return;
      }
      if (size.cols === term.cols && size.rows === term.rows) {
        // A re-announcement of the grid already rendered — a reconnect, or a
        // font refresh relaying out a claimed pane at new glyph metrics.
        if (claimed) scheduleScaledLayout();
        return;
      }
      // Another client claimed the grid. Follow it — letterboxed, badged —
      // rather than fighting back; a click or keystroke here is what reclaims.
      regrid(size);
      remoteSizeRef.current = size;
      setRemoteSize(size);
      setTerminalRemoteClaim(id, size);
      scheduleScaledLayout();
    });

    // ----- Touch: the drag that scrolls, the swipe that moves the cursor,
    //             the pinch that sizes the text, and the press that selects --
    //
    // Registered here rather than as React props because all of these have to
    // be able to cancel the browser's own gesture, and React's touch listeners
    // are passive — `preventDefault` inside one does nothing. The container
    // also carries `touch-none`, so iOS never claims the drag as a pan of the
    // page before the first move event arrives.
    //
    // A gesture is one of four things and never two: a **drag**, which locks
    // to an axis on its first real movement and keeps it (vertical scrolls, or
    // walks a full-screen program's cursor; horizontal sends Left/Right, the
    // keys a phone has no room for and an agent's prompt is edited with); a
    // **pinch**, the moment a second finger lands, which sizes the text; a
    // **press**, one finger held still past `LONG_PRESS_MS`, which opens the
    // screen as selectable text; or a **tap**, which is a drag that never left
    // the slop and never lasted. The axis is decided from where the finger
    // started rather than from the last move, so a wobble cannot flip a scroll
    // into a swipe halfway down the screen — and the press is cancelled by
    // that same slop, so no travel is both.

    /** Live single-finger drag: where it began, where it was, what it became. */
    let drag: {
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      axis: GestureAxis | null;
      /** Horizontal only: sub-cell travel not yet worth a key. */
      carryX: number;
    } | null = null;

    /** Live pinch, from the second finger landing to the last one leaving. */
    let pinch: {
      startDistance: number;
      /** The font size the gesture started at — every step is measured from it. */
      baseSize: number;
      /** The size currently drawn, or null while nothing has changed — so a
       *  rest of two fingers commits nothing. */
      size: number | null;
    } | null = null;

    /**
     * The fifth gesture: one finger, still, for long enough to have meant
     * neither a tap nor a drag — which is the only way it can be told from
     * them, since all of those start identically.
     *
     * Firing takes the terminal's visible screen as it stands and hands it to
     * the overlay, where it is text a phone can select. The drag this press
     * was still nominally part of is dropped in the same breath, so the lift
     * that follows is not also a tap on a link.
     */
    const longPress = createLongPress({
      slopPx: TOUCH_SLOP_PX,
      onFire: (x, y) => {
        const cell = cellAt(x, y);
        drag = null;
        endDrag(term);
        setSelecting({
          rows: snapshotRows(term.buffer.active, term.rows),
          at: cell,
        });
      },
    });

    /** Two fingers on the glass, however they got there. */
    const beginPinch = (event: TouchEvent) => {
      drag = null;
      longPress.cancel();
      endDrag(term);
      pinch = {
        startDistance: touchDistance(event.touches[0], event.touches[1]),
        baseSize: useReviewStore.getState().terminalFontSize,
        size: null,
      };
    };

    /**
     * The pinch's one write to anything but this terminal's own glyphs.
     *
     * Same act as the A−/A+ buttons and for the same reason: on a compact pane
     * a bigger font on the same grid is drawn at a smaller scale and arrives
     * the size it left, so bigger text has to mean fewer columns. Held to the
     * gesture's end because storing the preference writes localStorage and
     * refits every owner terminal in the app, and a fit resizes the PTY every
     * client shares — one per move event would be a hundred of both.
     */
    const endPinch = () => {
      const size = pinch?.size ?? null;
      pinch = null;
      if (size !== null) applyTerminalFontSize(id, size);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        // Cancels whatever one finger had started: a pinch is never also a
        // swipe, and never the tap that raises the keyboard.
        beginPinch(event);
        // Safari would otherwise take this as a page zoom.
        event.preventDefault();
        return;
      }
      // A finger landing while a pinch is still winding down is that pinch's,
      // not the start of a drag.
      if (pinch) return;
      const touch = event.touches[0];
      drag = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        axis: null,
        carryX: 0,
      };
      // Only where fingers are the whole story. A mouse has a real selection
      // already, and a trackpad that happened to send touches would start
      // arming a mode nobody on that machine needs.
      if (touchPrimaryRef.current)
        longPress.start(touch.clientX, touch.clientY);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (pinch) {
        if (event.touches.length < 2) return;
        event.preventDefault();
        const distance = touchDistance(event.touches[0], event.touches[1]);
        const steps = pinchSteps(distance / pinch.startDistance);
        const next = clampTerminalFontSize(
          pinch.baseSize + steps * TERMINAL_FONT_SIZE_STEP,
        );
        if (next === (pinch.size ?? pinch.baseSize)) return;
        // Live, so the text follows the fingers — but on this terminal's glyphs
        // alone. `endPinch` is what makes it the preference and refits the grid.
        pinch.size = next;
        previewFontSize(id, next);
        return;
      }
      if (!drag || event.touches.length !== 1) return;
      const touch = event.touches[0];
      // Movement past the same slop that commits a drag is what says this was
      // never a press — one threshold, so there is no band of travel that is
      // both.
      longPress.move(touch.clientX, touch.clientY);
      // The drawing may be scaled down, and the grid is measured in its own
      // unscaled pixels: a finger crossing a scaled pane crosses more cells
      // than the distance it travelled on glass.
      const scale = scaleRef.current || 1;
      // A finger moving up the screen pulls the text up with it, which is a
      // positive delta — the same sign a wheel uses for the same movement.
      const deltaY = drag.lastY - touch.clientY;
      const deltaX = touch.clientX - drag.lastX;
      drag.lastX = touch.clientX;
      drag.lastY = touch.clientY;
      if (drag.axis === null) {
        drag.axis = lockAxis(
          touch.clientX - drag.startX,
          touch.clientY - drag.startY,
          TOUCH_SLOP_PX,
        );
        if (drag.axis === null) return;
      }
      event.preventDefault();
      if (drag.axis === "vertical") {
        scrollByDrag(id, term, deltaY / scale);
        return;
      }
      const took = takeSteps(drag.carryX, deltaX / scale, cellWidth(term));
      drag.carryX = took.carry;
      if (took.steps === 0) return;
      // Through `sendKey` rather than an escape of our own: a program that has
      // negotiated the kitty protocol reads `CSI 1 ; 1 C`, not `\x1b[C`, and
      // Claude Code — the reason this gesture exists — is one of them. Capped
      // for the same reason a scroll drag is: one flick is otherwise dozens of
      // keypresses arriving as one event.
      sendKey(id, took.steps > 0 ? "right" : "left", {
        count: Math.min(Math.abs(took.steps), MAX_KEYS_PER_DRAG_EVENT),
      });
    };

    /**
     * Which cell a point on glass is over, as a fraction of the drawing.
     *
     * Fractions rather than cell metrics because a compact pane is *scaled*,
     * and that is exactly the sum xterm gets wrong for its own click handling
     * (see `openLinkAt`): it measures a scaled rect against unscaled cells. A
     * fraction of the drawing is the same fraction of the grid at any scale.
     */
    const cellAt = (clientX: number, clientY: number) => {
      const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return null;
      const rect = screen.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const col = Math.floor(((clientX - rect.left) / rect.width) * term.cols);
      const row = Math.floor(((clientY - rect.top) / rect.height) * term.rows);
      if (col < 0 || row < 0 || col >= term.cols || row >= term.rows) {
        return null;
      }
      return { col, row };
    };

    const onTouchEnd = (event: TouchEvent) => {
      longPress.cancel();
      if (pinch) {
        // Below two fingers there is no spread left to read. The finger that
        // may still be down is not a new drag — `drag` is null and only a
        // fresh `touchstart` can make one.
        if (event.touches.length < 2) endPinch();
        return;
      }
      const tapped = drag !== null && drag.axis === null;
      const touch = event.changedTouches[0];
      drag = null;
      endDrag(term);
      if (!tapped || !touch) return;
      const cell = cellAt(touch.clientX, touch.clientY);
      if (!cell || !openLinkAt(id, cell.col, cell.row)) return;
      // The tap was the link's. Swallowing it here is what keeps the
      // synthesized click from also focusing the shell and raising the
      // keyboard behind the page that is opening.
      event.preventDefault();
    };

    /**
     * The system took the gesture (a call, the app switcher). A pinch still
     * settles on the size the fingers had reached — the text they left on
     * screen is the size they asked for — and a drag simply ends. Nothing here
     * cancels an event, which is what lets this listener stay passive.
     */
    const onTouchCancel = () => {
      longPress.cancel();
      if (pinch) {
        endPinch();
        return;
      }
      drag = null;
      endDrag(term);
    };

    /**
     * iOS Safari's own pinch-zoom, which `touch-action` does not reach: it is
     * announced as a `gesture*` event and zooms the whole page, over a layout
     * whose whole point is fitting one screen.
     */
    const onGesture = (event: Event) => event.preventDefault();

    // touchstart is non-passive only so a second finger can cancel Safari's
    // page zoom. A one-finger start still never calls preventDefault — that
    // would swallow the synthesized click, and with it the tap that focuses
    // the shell and raises the keyboard.
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("touchcancel", onTouchCancel);
    container.addEventListener("gesturestart", onGesture);
    container.addEventListener("gesturechange", onGesture);

    // Debounced reaction to container size changes: an owner refits; a viewer
    // — and an owner letterboxing a claimed grid — only rescales its drawing,
    // so a window resize is not a silent reclaim.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (isViewer || remoteSizeRef.current) applyScaledLayout();
        else doFit();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);
    // Initial fit for a freshly opened/visible owner pane.
    if (!isViewer && !remoteSizeRef.current) doFit();

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect();
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchCancel);
      container.removeEventListener("gesturestart", onGesture);
      container.removeEventListener("gesturechange", onGesture);
      longPress.cancel();
      endDrag(term);
      onDataDisposable.dispose();
      unsubGrid();
      reclaimRef.current = null;
      setFitAction(id, null);
      setTerminalMountPolicy(id, null);
      // The next mount decides its own layout, but don't leave a scale on an
      // instance that may next be adopted by a differently-sized pane.
      clearScaledLayout();
      termRef.current = null;
      // Keep the registry instance alive — do NOT dispose here, and leave its
      // output subscription running so a hidden session keeps filling its
      // buffer instead of losing the bytes.
    };
  }, [id, isViewer]);

  // Font changes are pushed to every live terminal (including this one) by
  // refreshAllTerminalOptions, called from the preferencesSlice setters — no
  // per-pane effect needed here.

  // The transport, for the notice below. Only web mode ever answers anything
  // but `false` — the desktop's IPC has no socket to lose.
  useEffect(
    () => getApiClient().onTerminalConnection(id, setReconnecting),
    [id],
  );

  // A gap only worth reporting once it lasts: every socket starts disconnected
  // and an ordinary foreground reconnect finishes well inside the grace, so a
  // badge on every glance would be noise. Starting `false` is also what keeps a
  // pane from flashing one before the first callback arrives.
  useEffect(() => {
    if (!reconnecting) {
      setShowReconnecting(false);
      return;
    }
    const timer = setTimeout(
      () => setShowReconnecting(true),
      RECONNECT_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [reconnecting]);

  // A snapshot is out of date the moment the program prints anything, and
  // there is no version of this that is right in both directions: refreshing
  // under a live selection moves the text out from under the handles, which is
  // worse than reading a screen that is a second old. So it catches up only
  // while nothing is selected — putting the selection down is what makes it
  // current again — and it does that no more often than the eye would notice.
  const selectActive = selecting !== null;
  useEffect(() => {
    if (!selectActive) return;
    const term = termRef.current;
    if (!term) return;
    let last = 0;
    const sub = term.onRender(() => {
      const now = Date.now();
      if (now - last < SELECTION_REFRESH_MS) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      last = now;
      const rows = snapshotRows(term.buffer.active, term.rows);
      setSelecting((cur) =>
        cur && !sameRows(cur.rows, rows) ? { ...cur, rows } : cur,
      );
    });
    return () => sub.dispose();
  }, [selectActive]);

  // Refit when this pane becomes active (it may have been sized 0 while hidden).
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const container = containerRef.current;
    if (!term || !container) return;
    const raf = requestAnimationFrame(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Reconnecting wins: while the transport is down, the grid this pane is
  // letterboxing is itself only what was last heard.
  const notice = showReconnecting
    ? "Reconnecting…"
    : !isViewer && remoteSize
      ? `${remoteSize.cols}×${remoteSize.rows} · sized elsewhere — click to fit`
      : null;

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-surface-inset"
      onMouseDown={() => {
        termRef.current?.focus();
        // Clicking an owner pane whose grid is claimed elsewhere is the
        // deliberate "I'm using it here again" — take the size back.
        if (!isViewer && remoteSizeRef.current) reclaimRef.current?.();
      }}
    >
      {/* xterm's element is appended here imperatively; the overlays below live
          beside this div, never inside it, so React and xterm each own their
          own children. */}
      {/* `touch-none`: every touch here is the terminal's — a drag scrolls it
          (see the listeners above), and there is nothing behind it to pan. */}
      <div
        ref={containerRef}
        className="h-full w-full touch-none overflow-hidden"
      />

      {/* What the pane has to say about itself, in one place: that the picture
          is the past, or that the grid it is letterboxing belongs to someone
          else. Inert — the click "click to fit" invites lands on the pane and
          reclaims. */}
      {notice && (
        <div className="pointer-events-none absolute inset-x-0 top-1.5 z-10 flex justify-center">
          <span
            className="rounded bg-surface-raised/90 px-2 py-0.5 text-xxs
                       text-fg-muted"
          >
            {notice}
          </span>
        </div>
      )}

      {/* Compact's one way to change the shared grid, shown only while the
          drawing is actually scaled down. Deliberate by design: nothing on a
          phone resizes the PTY except this tap. */}
      {compact && viewScale < 0.999 && !selecting && (
        <button
          type="button"
          // Not a reason to focus the shell — the wrapper's mousedown would
          // raise the soft keyboard mid-fit, shrinking the very viewport the
          // fit is measuring.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => requestFit(id)}
          className="absolute bottom-2 right-2 z-10 rounded-md
                     bg-surface-raised/90 px-2.5 py-1.5 text-xs text-fg-muted
                     shadow-sm hover:text-fg-secondary"
        >
          Fit to screen
        </button>
      )}

      {/* What a long press put here: the visible screen as text, over the
          canvas that cannot be selected. Mounted only while it is being used,
          so nothing about the terminal's ordinary behaviour goes through it. */}
      {selecting && layout && (
        <TerminalSelectionOverlay
          rows={selecting.rows}
          at={selecting.at}
          layout={layout}
          font={{ fontFamily, fontSize, letterSpacing }}
          onExit={exitSelect}
        />
      )}
    </div>
  );
}

/**
 * How often a select-mode snapshot may catch up with the terminal under it.
 *
 * Only reached while nothing is selected, so this is not about correctness —
 * it is about not rebuilding forty DOM rows on every frame of a program that
 * is repainting continuously, which is what the terminals this app is for do.
 */
const SELECTION_REFRESH_MS = 250;

/** Whether two snapshots say the same thing, so an idle screen re-renders
 *  nothing. */
function sameRows(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i]);
}

/** Whether the drawing's box has actually moved — a resize that lands on the
 *  same numbers must not re-render the overlay sitting on them. */
function sameLayout(
  a: SelectionLayout | null,
  b: SelectionLayout | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.scale === b.scale
  );
}
