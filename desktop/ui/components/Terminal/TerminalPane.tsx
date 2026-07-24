import { type ReactNode, useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import { getApiClient } from "../../api";
import { useReviewStore } from "../../stores";
import { acquireTerminal, applyLigatures, applyRenderer } from "./registry";
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
}

const RESIZE_DEBOUNCE_MS = 50;

/**
 * Renders a single terminal session into a kept-alive xterm instance. The
 * instance lives in the module registry (see registry.ts), so unmounting this
 * pane detaches the DOM but preserves the buffer — remounting re-attaches with
 * no flicker. Raw PTY output flows transport → xterm directly, never through
 * the store.
 */
export function TerminalPane({ id, active }: TerminalPaneProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fontFamily = useReviewStore((s) => s.terminalFontFamily);
  const fontSize = useReviewStore((s) => s.terminalFontSize);
  const fontWeight = useReviewStore((s) => s.terminalFontWeight);
  const lineHeight = useReviewStore((s) => s.terminalLineHeight);
  const letterSpacing = useReviewStore((s) => s.terminalLetterSpacing);
  const renderer = useReviewStore((s) => s.terminalRenderer);
  const ligatures = useReviewStore((s) => s.terminalLigatures);

  // Keep the latest options in refs so the setup effect (keyed only on id)
  // reads current values without re-running and re-opening the terminal. Live
  // changes are pushed to open terminals by the preferencesSlice setters.
  const optionsRef = useRef({
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    renderer,
    ligatures,
  });
  optionsRef.current = {
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    renderer,
    ligatures,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const client = getApiClient();

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

    // Attach (or re-attach) the terminal's DOM element into our container.
    if (term.element && term.element.parentElement !== container) {
      container.appendChild(term.element);
    } else if (!term.element) {
      term.open(container);
    }
    // Select the renderer (must be after open() for WebGL), then ligatures
    // (DOM-only; applyLigatures no-ops under WebGL).
    applyRenderer(id, opts.renderer);
    applyLigatures(id, opts.ligatures, opts.renderer);

    // xterm can be disposed out from under this callback (the tab is closed
    // while PTY output is still in flight); swallow writes to a dead instance
    // rather than throwing.
    const safeWrite = (bytes: Uint8Array) => {
      try {
        term.write(bytes);
      } catch {
        /* terminal disposed */
      }
    };

    // Subscribe to output BEFORE replay. Buffer live output (with its byte
    // cursor) until any replay is written so historical scrollback lands ahead
    // of new bytes and overlapping bytes render exactly once.
    let replayed = false;
    const pending: { data: Uint8Array; seq: number }[] = [];
    const unsubOutput = client.onTerminalOutput(id, ({ data, seq }) => {
      if (replayed) {
        safeWrite(data);
      } else {
        pending.push({ data, seq });
      }
    });

    // Flush buffered live output. On a cold reattach, `cursor` is the byte
    // offset the replay snapshot ends at, so any chunk already contained in the
    // replay (`seq <= cursor`) is dropped; the seq/cursor boundary always aligns
    // to a chunk edge, so no chunk straddles it. Without a cursor (fresh/warm
    // reattach, or replay failure) every buffered chunk is written.
    const flushPending = (cursor = -1) => {
      replayed = true;
      for (const chunk of pending) {
        if (chunk.seq > cursor) safeWrite(chunk.data);
      }
      pending.length = 0;
    };

    if (isNew && !wasFresh) {
      // Cold reattach (new window / web reload): replay the ring buffer.
      client
        .terminalReplay(id)
        .then(({ dataB64, cursor, status }) => {
          if (dataB64) safeWrite(decodeBase64(dataB64));
          flushPending(cursor);
          useReviewStore.getState().applyTerminalStatus(status);
        })
        .catch((err) => {
          console.error("[terminal] Replay failed:", err);
          flushPending();
        });
    } else {
      flushPending();
    }

    // Send keystrokes to the PTY.
    const onDataDisposable = term.onData((data) => {
      client.terminalWrite(id, data).catch((err) => {
        console.error("[terminal] Write failed:", err);
      });
    });

    // Debounced fit + backend resize on container size changes.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const doFit = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      client
        .terminalResize(id, term.cols, term.rows)
        .catch((err) => console.error("[terminal] Resize failed:", err));
    };
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doFit, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);
    // Initial fit for a freshly opened/visible pane.
    doFit();

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect();
      onDataDisposable.dispose();
      unsubOutput();
      termRef.current = null;
      // Keep the registry instance alive — do NOT dispose here.
    };
  }, [id]);

  // Font/renderer/ligature changes are pushed to every live terminal (including
  // this one) by refreshAllTerminalOptions / applyRendererToAll /
  // applyLigaturesToAll, called from the preferencesSlice setters — no per-pane
  // effect needed here.

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
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-surface-inset"
      onMouseDown={() => termRef.current?.focus()}
    />
  );
}
