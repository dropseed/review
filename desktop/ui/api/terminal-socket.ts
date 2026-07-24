/**
 * TerminalSocket — the web-mode PTY transport.
 *
 * One socket per terminal session, wrapping `GET /api/terminal/{id}/ws`. It
 * normalizes the WebSocket wire contract into the SAME callback shapes the
 * TauriClient delivers, so `HttpClient` can feed the exact same registries as
 * the desktop path:
 *
 *   server → client  Binary = 8-byte big-endian u64 `seq` cursor + raw PTY
 *                             output; Text = `{"t":"status",...}` | `{"t":"exit"}`
 *   client → server  Binary = stdin bytes; Text = `{"t":"resize","cols","rows"}`
 *
 * The stream is purely live — the server sends no replay frame on connect. Each
 * Binary frame carries an 8-byte cursor header stripped here; the remaining
 * bytes pass to `onOutput` as a Uint8Array view (no copy, no base64) alongside
 * the decoded `seq`, which a cold-reattaching pane uses to deduplicate against
 * its `replay` snapshot.
 *
 * A socket close is NOT a session kill: unexpected closes trigger jittered
 * exponential-backoff reconnects. `close()` (kill), a `4404` close (session
 * gone), or an `exit` frame (child exited) all stop the retry loop.
 */

import type { TerminalStatus } from "../types";

/** Close code the server uses to signal the session no longer exists. */
export const SESSION_GONE_CODE = 4404;

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8000;
const WS_OPEN = 1;

/** Callbacks the socket feeds decoded frames into. */
export interface TerminalSocketHandlers {
  /**
   * Live PTY output: a Uint8Array view over the WS frame (header stripped) plus
   * the scrollback byte cursor (`seq`) the chunk ends at.
   */
  onOutput: (data: Uint8Array, seq: number) => void;
  onStatus: (status: TerminalStatus) => void;
  /** exitCode is null when the session is simply gone (server restart / 4404). */
  onExit: (exitCode: number | null) => void;
}

/** Bytes of the big-endian u64 `seq` cursor prefixed to each Binary frame. */
const SEQ_HEADER_BYTES = 8;

export interface TerminalSocketOptions {
  /** Injectable WebSocket implementation (tests). Defaults to global WebSocket. */
  webSocketImpl?: typeof WebSocket;
  /** Injectable jitter source (tests). Defaults to Math.random. */
  rand?: () => number;
  /** Override the ws:// URL (tests). Defaults to a location-derived URL. */
  urlFor?: (id: string) => string;
}

/**
 * Exponential backoff with full jitter, capped. attempt 0 → up to 500ms,
 * doubling each attempt, never exceeding 8s. Jitter spreads the delay across
 * [ceiling/2, ceiling] so simultaneous reconnects don't align.
 */
export function backoffDelay(
  attempt: number,
  rand: () => number = Math.random,
): number {
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  return ceiling / 2 + rand() * (ceiling / 2);
}

function defaultUrlFor(id: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Goes through the Vite dev proxy (ws: true) in dev, direct otherwise.
  return `${proto}//${window.location.host}/api/terminal/${id}/ws`;
}

export class TerminalSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private sessionGone = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly WebSocketImpl: typeof WebSocket;
  private readonly rand: () => number;
  private readonly urlFor: (id: string) => string;

  constructor(
    private readonly id: string,
    private readonly handlers: TerminalSocketHandlers,
    options: TerminalSocketOptions = {},
  ) {
    this.WebSocketImpl = options.webSocketImpl ?? WebSocket;
    this.rand = options.rand ?? Math.random;
    this.urlFor = options.urlFor ?? defaultUrlFor;
  }

  /**
   * Open the socket if it isn't already connecting/open. Idempotent — safe to
   * call from every path that wants the session streaming.
   */
  connect(): void {
    if (this.closedByUser || this.sessionGone) return;
    if (this.ws) return; // already connecting or open
    this.open();
  }

  /** True once the socket is open and can carry stdin/resize frames. */
  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  /** Send UTF-8 stdin bytes as a Binary frame. No-op while not open or gone. */
  sendInput(data: string): void {
    if (this.sessionGone || !this.isOpen()) return;
    this.ws!.send(new TextEncoder().encode(data));
  }

  /** Send a resize as a Text frame. No-op while not open or gone. */
  sendResize(cols: number, rows: number): void {
    if (this.sessionGone || !this.isOpen()) return;
    this.ws!.send(JSON.stringify({ t: "resize", cols, rows }));
  }

  /** Explicit teardown (session killed). Stops reconnect; emits no exit. */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
  }

  // ----- Internals -----

  private open(): void {
    this.teardownSocket();
    const ws = new this.WebSocketImpl(this.urlFor(this.id));
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
    };
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev);
    ws.onclose = (ev: CloseEvent) => this.handleClose(ev);
    ws.onerror = () => {
      /* onclose drives reconnect; nothing to do here */
    };
  }

  private handleMessage(ev: MessageEvent): void {
    if (typeof ev.data === "string") {
      this.handleText(ev.data);
      return;
    }
    // Binary frame: 8-byte big-endian u64 `seq` cursor, then raw PTY bytes.
    const buf = ev.data as ArrayBuffer;
    if (buf.byteLength < SEQ_HEADER_BYTES) return; // malformed; drop
    const seq = Number(new DataView(buf).getBigUint64(0, false));
    const data = new Uint8Array(buf, SEQ_HEADER_BYTES);
    this.handlers.onOutput(data, seq);
  }

  private handleText(text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return; // drop malformed
    }
    if (!msg || typeof msg !== "object") return;
    const t = (msg as { t?: unknown }).t;
    if (t === "status") {
      this.handlers.onStatus(msg as TerminalStatus);
    } else if (t === "exit") {
      // The child exited: the server's follow-up normal close must NOT trigger a
      // reconnect to a dead session. Mark the socket gone before the close lands.
      this.sessionGone = true;
      const code = (msg as { exitCode?: unknown }).exitCode;
      this.handlers.onExit(typeof code === "number" ? code : null);
    }
    // Unknown/missing tags are ignored.
  }

  private handleClose(ev: CloseEvent): void {
    this.ws = null;
    if (this.closedByUser) return;
    // An `exit` frame already marked the session gone — the close that follows it
    // is expected and must not reconnect.
    if (this.sessionGone) return;
    if (ev.code === SESSION_GONE_CODE) {
      this.sessionGone = true;
      this.handlers.onExit(null);
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = backoffDelay(this.reconnectAttempts, this.rand);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private teardownSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
