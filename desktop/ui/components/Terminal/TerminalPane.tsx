import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { getApiClient } from "../../api";
import { useReviewStore } from "../../stores";
import { useIsCompact } from "../../hooks/useIsCompact";
import {
  acquireTerminal,
  attachRenderer,
  beginTerminalReplay,
  endDrag,
  onTerminalGrid,
  openLinkAt,
  requestFit,
  scrollByDrag,
  setFitAction,
  seedTerminalGridSize,
  setTerminalMountPolicy,
  setTerminalRemoteClaim,
  startTerminalOutput,
  terminalGridSize,
  terminalRemoteClaim,
  terminalReplayInFlight,
} from "./registry";
import { applyArmedModifiers } from "./soft-keys";
import { buildXtermTheme } from "./xterm-theme";
import { TERMINAL_FONT_WEIGHT_BOLD } from "../../stores/slices/preferencesSlice";
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
 * How far a finger travels before the gesture is a scroll rather than a tap.
 *
 * Below it nothing scrolls and nothing is cancelled, so the tap that focuses
 * the shell (and raises the keyboard) still lands with the small movement any
 * real thumb makes.
 */
const TOUCH_SLOP_PX = 6;

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
  /** Viewer only: the scale the grid is drawn at (1 = fits naturally). */
  const [viewScale, setViewScale] = useState(1);
  /** The same number, readable from the touch handlers without re-binding
   *  them every time the drawing rescales. */
  const scaleRef = useRef(1);
  /** Owner reclaim (fit + resize), reachable from render handlers. */
  const reclaimRef = useRef<(() => void) | null>(null);

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
    setViewScale(1);

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
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transformOrigin = "top left";
      el.style.transform =
        `translate(${Math.max(0, (cw - w * s) / 2)}px, ` +
        `${Math.max(0, (ch - h * s) / 2)}px) scale(${s})`;
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
      setViewScale(s);
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
    };

    const scheduleScaledLayout = () => requestAnimationFrame(applyScaledLayout);

    /** Match the local xterm grid to the PTY's. Rendering raw PTY bytes at any
     *  other width draws garbage, not a smaller screen. */
    const regrid = ({ cols, rows }: GridSize) => {
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
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
      // The phone's key bar arms Control here rather than sending anything of
      // its own: the key it modifies comes from the system keyboard, and this
      // is where that keystroke passes (see soft-keys.ts).
      client.terminalWrite(id, applyArmedModifiers(data)).catch((err) => {
        console.error("[terminal] Write failed:", err);
      });
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

    // ----- Touch: the drag that scrolls -----
    //
    // Registered here rather than as React props because both of these have to
    // be able to cancel the browser's own gesture, and React's touch listeners
    // are passive — `preventDefault` inside one does nothing. The container
    // also carries `touch-none`, so iOS never claims the drag as a pan of the
    // page before the first move event arrives.
    let dragY: number | null = null;
    let dragTravel = 0;

    const onTouchStart = (event: TouchEvent) => {
      // Two fingers is a zoom or a system gesture, not ours.
      if (event.touches.length !== 1) {
        dragY = null;
        return;
      }
      dragY = event.touches[0].clientY;
      dragTravel = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (dragY === null || event.touches.length !== 1) return;
      const y = event.touches[0].clientY;
      // A finger moving up the screen pulls the text up with it, which is a
      // positive delta — the same sign a wheel uses for the same movement.
      const delta = dragY - y;
      dragY = y;
      dragTravel += Math.abs(delta);
      if (dragTravel < TOUCH_SLOP_PX) return;
      event.preventDefault();
      // The drawing may be scaled down, and the grid is measured in its own
      // unscaled pixels: a finger crossing a scaled pane crosses more rows
      // than the distance it travelled on glass.
      scrollByDrag(id, term, delta / (scaleRef.current || 1));
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
      const tapped = dragY !== null && dragTravel < TOUCH_SLOP_PX;
      const touch = event.changedTouches[0];
      dragY = null;
      endDrag(term);
      if (!tapped || !touch) return;
      const cell = cellAt(touch.clientX, touch.clientY);
      if (!cell || !openLinkAt(id, cell.col, cell.row)) return;
      // The tap was the link's. Swallowing it here is what keeps the
      // synthesized click from also focusing the shell and raising the
      // keyboard behind the page that is opening.
      event.preventDefault();
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });

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
      container.removeEventListener("touchcancel", onTouchEnd);
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

      {/* An owner letterboxing a grid another client claimed says so, quietly.
          Inert — the click it invites lands on the pane and reclaims. */}
      {!isViewer && remoteSize && (
        <div className="pointer-events-none absolute inset-x-0 top-1.5 z-10 flex justify-center">
          <span
            className="rounded bg-surface-raised/90 px-2 py-0.5 text-xxs
                       text-fg-muted"
          >
            {remoteSize.cols}×{remoteSize.rows} · sized elsewhere — click to fit
          </span>
        </div>
      )}

      {/* Compact's one way to change the shared grid, shown only while the
          drawing is actually scaled down. Deliberate by design: nothing on a
          phone resizes the PTY except this tap. */}
      {compact && viewScale < 0.999 && (
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
    </div>
  );
}
