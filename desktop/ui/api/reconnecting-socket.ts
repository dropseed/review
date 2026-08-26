/**
 * ReconnectingSocket — the connection lifecycle both web-mode sockets share.
 *
 * The PTY transport (`TerminalSocket`) and the announcement channel
 * (`TerminalEventsSocket`) differ only in what their frames mean and in what a
 * close means. Everything under that — opening at most one socket, jittered
 * exponential-backoff reconnects, tearing handlers off a socket before dropping
 * it so a late close can't schedule a retry for a socket nobody holds — is one
 * policy, and lives here.
 *
 * A subclass supplies its URL, reads its own frames, and says what a close
 * means. Nothing else.
 */

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8000;
const WS_OPEN = 1;

export interface ReconnectingSocketOptions {
  /** Injectable WebSocket implementation (tests). Defaults to global WebSocket. */
  webSocketImpl?: typeof WebSocket;
  /** Injectable jitter source (tests). Defaults to Math.random. */
  rand?: () => number;
  /** Override the ws:// URL (tests). Defaults to the subclass's own. */
  url?: () => string;
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

/** This origin's ws:// (or wss://) URL for an API path. */
export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Goes through the Vite dev proxy (ws: true) in dev, direct otherwise.
  return `${proto}//${window.location.host}${path}`;
}

export abstract class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly WebSocketImpl: typeof WebSocket;
  private readonly rand: () => number;
  private readonly urlOverride?: () => string;

  /**
   * Set by a subclass when what is on the other end is gone for good (the
   * session exited, or the server said `4404`). Stops the retry loop and keeps
   * `connect()` a no-op — a reconnect would only be told the same thing again.
   */
  protected gone = false;

  protected constructor(options: ReconnectingSocketOptions = {}) {
    this.WebSocketImpl = options.webSocketImpl ?? WebSocket;
    this.rand = options.rand ?? Math.random;
    this.urlOverride = options.url;
  }

  // ----- Subclass policy -----

  /** The URL to open, when the caller hasn't overridden it. */
  protected abstract defaultUrl(): string;

  /** One frame off the wire. */
  protected abstract handleMessage(ev: MessageEvent): void;

  /** Prepare the raw socket before its handlers are attached (binaryType). */
  protected configure(_ws: WebSocket): void {}

  /** The socket is open. */
  protected handleOpen(): void {}

  /**
   * What this close means. Returning false stops the retry loop — which is
   * where a subclass sets `gone` and tells its handlers. Default: reconnect.
   */
  protected shouldReconnect(_ev: CloseEvent): boolean {
    return true;
  }

  // ----- Lifecycle -----

  /**
   * Open the socket if it isn't already connecting/open. Idempotent — safe to
   * call from every path that wants the stream running.
   */
  connect(): void {
    if (this.closedByUser || this.gone) return;
    if (this.ws) return; // already connecting or open
    this.open();
  }

  /** True once the socket is open and can carry frames. */
  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  /** Explicit teardown. Stops the reconnect loop. */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
  }

  /** Send a frame. No-op while the socket isn't open. */
  protected send(data: string | ArrayBufferView): void {
    if (!this.isOpen()) return;
    this.ws!.send(data);
  }

  // ----- Internals -----

  private open(): void {
    this.teardownSocket();
    const ws = new this.WebSocketImpl(
      this.urlOverride?.() ?? this.defaultUrl(),
    );
    this.configure(ws);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.handleOpen();
    };
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev);
    ws.onclose = (ev: CloseEvent) => {
      this.ws = null;
      if (this.closedByUser) return;
      // A subclass that has already declared the far end gone (an `exit` frame,
      // say) gets the close that follows it, and must not reconnect to it.
      if (this.gone) return;
      if (!this.shouldReconnect(ev)) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose drives reconnect; nothing to do here */
    };
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
