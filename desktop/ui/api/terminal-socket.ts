/**
 * TerminalSocket — the web-mode PTY transport.
 *
 * One socket per terminal session, wrapping `GET /api/terminal/{id}/ws`. It
 * normalizes the WebSocket wire contract into the SAME callback shapes the
 * TauriClient delivers, so `HttpClient` can feed the exact same registries as
 * the desktop path:
 *
 *   server → client  Binary = 8-byte big-endian u64 `seq` cursor + raw PTY
 *                             output; Text = `{"t":"status",...}` |
 *                             `{"t":"resize","cols","rows"}` (any client resized
 *                             the shared PTY) | `{"t":"exit"}` | `{"t":"pong"}`
 *   client → server  Binary = stdin bytes; Text = `{"t":"resize","cols","rows"}`
 *                             | `{"t":"ping"}` (liveness probe)
 *
 * The stream is purely live — the server sends no replay frame on connect. Each
 * Binary frame carries an 8-byte cursor header stripped here; the remaining
 * bytes pass to `onOutput` as a Uint8Array view (no copy, no base64) alongside
 * the decoded `seq`, which a cold-reattaching pane uses to deduplicate against
 * its `replay` snapshot.
 *
 * A socket close is NOT a session kill: unexpected closes reconnect on
 * `ReconnectingSocket`'s backoff. `close()` (kill), a `4404` close (session
 * gone), or an `exit` frame (child exited) all stop the retry loop.
 *
 * ## Coming back from the background
 *
 * iOS suspends a backgrounded PWA's socket the moment the app leaves the
 * screen, and the two ways that goes wrong are different problems:
 *
 * - The socket **closed** while suspended. That is `ReconnectingSocket.wake`'s
 *   case: the backoff that was going to reconnect is sitting on a delay
 *   measured from a suspended clock, so it is thrown away and the socket dials
 *   immediately.
 * - The socket is **open on paper and dead on the wire** — iOS is happy to
 *   leave `readyState === OPEN` on a connection nothing will ever arrive on.
 *   Nothing observable distinguishes it from a quiet shell, so this subclass
 *   extends `wake()` to ask: `{"t":"ping"}`, and anything at all coming back
 *   within `PROBE_TIMEOUT_MS` is proof of life. Silence reconnects. (A browser
 *   cannot send a protocol ping or see the server's, which is why this is an
 *   application frame.)
 *
 * Either way the bytes printed while away are gone from the live stream, which
 * only ever carries what is happening now. `resume()` is the other half:
 * re-fetch the scrollback ring, and write the slice **past** the last `seq`
 * this socket delivered. That slice is exact — the daemon's `seq` counts every
 * byte ever written and the ring's cursor is the same counter, so
 * `cursor - lastSeq` bytes off the end of the snapshot is precisely what was
 * missed, resuming xterm's parser mid-escape-sequence if that is where the gap
 * began. It runs wherever a connection is (re)established — `handleOpen`, which
 * both branches above lead to — and it is what makes a returning tab current in
 * one HTTP round trip rather than whenever the shell next prints something. A
 * socket that was never actually interrupted fetches nothing: it missed
 * nothing.
 */

import type { TerminalStatus } from "../types";
import {
  ReconnectingSocket,
  wsUrl,
  type ReconnectingSocketOptions,
} from "./reconnecting-socket";

/** Close code the server uses to signal the session no longer exists. */
export const SESSION_GONE_CODE = 4404;

/**
 * How long a foreground liveness probe waits for any inbound frame before the
 * socket is treated as dead. Short, because the cost of being wrong is one
 * reconnect and the cost of waiting is a pane that looks alive and is not.
 */
export const PROBE_TIMEOUT_MS = 1500;

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
  /** The shared PTY was resized (by any client, this one included). */
  onResize: (cols: number, rows: number) => void;
}

/** Bytes of the big-endian u64 `seq` cursor prefixed to each Binary frame. */
const SEQ_HEADER_BYTES = 8;

export interface TerminalSocketOptions extends ReconnectingSocketOptions {
  /**
   * Fetch the session's scrollback ring and the byte cursor it ends at — the
   * `POST /api/terminal/replay` the owning client already speaks. Without it a
   * reconnect resumes live-only and whatever printed during the gap is lost.
   */
  fetchReplay?: (id: string) => Promise<{ data: Uint8Array; cursor: number }>;
}

export class TerminalSocket extends ReconnectingSocket {
  /** Not-yet-connected reads as reconnecting: honest, and never shown — the
   *  pane waits out a grace period that a first connect finishes inside. */
  private reconnecting = true;
  private readonly stateListeners = new Set<(reconnecting: boolean) => void>();

  /**
   * The byte cursor this socket has delivered up to — the `seq` of the last
   * chunk handed to `onOutput`, or the cursor of the last replay the owning
   * client fetched (`noteCursor`). `null` means nothing has established a
   * position yet, so there is no gap anyone could name.
   */
  private lastSeq: number | null = null;
  /** True while a resume fetch is in flight; live chunks queue behind it. */
  private resuming = false;
  private resumeQueue: Array<{ data: Uint8Array; seq: number }> = [];

  /** Non-null while a liveness probe is outstanding — a live timer *is* the
   *  waiting, so there is no second flag to keep in step with it. */
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly fetchReplay?: (
    id: string,
  ) => Promise<{ data: Uint8Array; cursor: number }>;

  constructor(
    private readonly id: string,
    private readonly handlers: TerminalSocketHandlers,
    options: TerminalSocketOptions = {},
  ) {
    super(options);
    this.fetchReplay = options.fetchReplay;
  }

  /**
   * Whether the transport is currently down, and every change to that. Fires
   * immediately with the current answer; returns unsubscribe.
   *
   * A session that is *gone* is not a connection fact — the pane hears about an
   * exit from `onExit`, and a socket with nothing left to carry reports itself
   * connected rather than claiming it is on its way back.
   */
  onState(listener: (reconnecting: boolean) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.reconnecting);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Whether the transport is currently down. */
  isReconnecting(): boolean {
    return this.reconnecting;
  }

  /**
   * The tab came back to the foreground. A closed socket is the base class's
   * case; an *open* one still has to prove it — see the class comment.
   */
  override wake(): void {
    if (this.stopped) return;
    if (!this.isOpen()) {
      super.wake();
      return;
    }
    // No `resume()` here. An open socket that answers its probe never stopped
    // carrying bytes, and re-fetching the ring for a tab that merely came back
    // to the foreground is a round trip per session for nothing. Catching up is
    // what a *broken* transport owes, so it is done where one is found: the
    // reconnect's `handleOpen`, and the probe that times out.
    this.probe();
  }

  /**
   * Note a scrollback cursor the owning client fetched out-of-band (the pane's
   * cold-reattach replay), so a socket that has not yet carried a byte still
   * knows where it stands and can resume from there.
   */
  noteCursor(cursor: number): void {
    if (this.lastSeq === null || cursor > this.lastSeq) this.lastSeq = cursor;
  }

  /** Send UTF-8 stdin bytes as a Binary frame. No-op while not open or gone. */
  sendInput(data: string): void {
    if (this.gone) return;
    this.send(new TextEncoder().encode(data));
  }

  /** Send a resize as a Text frame. No-op while not open or gone. */
  sendResize(cols: number, rows: number): void {
    if (this.gone) return;
    this.send(JSON.stringify({ t: "resize", cols, rows }));
  }

  /** Explicit teardown (session killed). Stops reconnect; emits no exit. */
  override close(): void {
    this.clearProbe();
    super.close();
    this.setReconnecting(false);
  }

  // ----- ReconnectingSocket policy -----

  protected defaultUrl(): string {
    return wsUrl(`/api/terminal/${this.id}/ws`);
  }

  protected configure(ws: WebSocket): void {
    ws.binaryType = "arraybuffer";
  }

  protected handleOpen(): void {
    this.setReconnecting(false);
    // Whatever printed while this socket was down is in the ring, not in the
    // live stream that just started.
    void this.resume();
  }

  protected handleMessage(ev: MessageEvent): void {
    // Any frame at all proves the peer is there — the probe wants no more.
    this.clearProbe();
    if (typeof ev.data === "string") {
      this.handleText(ev.data);
      return;
    }
    // Binary frame: 8-byte big-endian u64 `seq` cursor, then raw PTY bytes.
    const buf = ev.data as ArrayBuffer;
    if (buf.byteLength < SEQ_HEADER_BYTES) return; // malformed; drop
    const seq = Number(new DataView(buf).getBigUint64(0, false));
    const data = new Uint8Array(buf, SEQ_HEADER_BYTES);
    if (this.resuming) {
      this.resumeQueue.push({ data, seq });
      return;
    }
    this.lastSeq = seq;
    this.handlers.onOutput(data, seq);
  }

  protected shouldReconnect(ev: CloseEvent): boolean {
    this.clearProbe();
    if (ev.code === SESSION_GONE_CODE) {
      this.gone = true;
      this.setReconnecting(false);
      this.handlers.onExit(null);
      return false;
    }
    this.setReconnecting(true);
    return true;
  }

  // ----- Internals -----

  private setReconnecting(reconnecting: boolean): void {
    if (this.reconnecting === reconnecting) return;
    this.reconnecting = reconnecting;
    for (const listener of this.stateListeners) listener(reconnecting);
  }

  /** Ask the server to prove this socket is still carrying frames. */
  private probe(): void {
    if (this.probeTimer) return; // one in flight is enough
    try {
      this.send(JSON.stringify({ t: "ping" }));
    } catch {
      // A send that throws is already an answer.
      this.dial();
      return;
    }
    this.probeTimer = setTimeout(() => {
      // Still armed when it fired, so nothing came back: this is one of iOS's
      // open-on-paper corpses. `dial` is what goes and gets the bytes that
      // printed while nobody was carrying them.
      this.probeTimer = null;
      this.dial();
    }, PROBE_TIMEOUT_MS);
  }

  /** Reconnect now, and say so — the badge goes up before the dial, because
   *  the gap it is reporting has already happened. */
  private dial(): void {
    if (this.stopped) return;
    this.clearProbe();
    this.setReconnecting(true);
    this.reconnectNow();
  }

  /** Any inbound frame answers the probe — a live timer is the only record of
   *  one being outstanding, so clearing it *is* the answer. */
  private clearProbe(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  /**
   * Write the bytes that landed while this client was not listening.
   *
   * Live chunks arriving during the fetch are held rather than raced past it:
   * the same ordering `startTerminalOutput` enforces on a cold attach, for the
   * same reason — scrollback before live output, or the screen is spliced out
   * of order. Anything the snapshot already contains (`seq <= cursor`) is
   * dropped; the daemon appends to the ring and the stream in the same chunks,
   * so that boundary always falls on a chunk edge.
   */
  private async resume(): Promise<void> {
    if (!this.fetchReplay || this.lastSeq === null || this.resuming) return;
    const from = this.lastSeq;
    this.resuming = true;
    try {
      const { data, cursor } = await this.fetchReplay(this.id);
      const missed = cursor - from;
      if (missed > 0) {
        // The ring is a window: a gap wider than it means bytes are simply
        // gone, and the whole snapshot (resync-trimmed by the daemon) is the
        // most honest thing left to draw.
        const bytes =
          missed <= data.length ? data.subarray(data.length - missed) : data;
        if (bytes.length > 0) this.handlers.onOutput(bytes, cursor);
        this.lastSeq = cursor;
      }
    } catch {
      // No snapshot: the live stream is still the truth from here on.
    } finally {
      this.resuming = false;
      this.flushResumeQueue();
    }
  }

  private flushResumeQueue(): void {
    const queued = this.resumeQueue;
    this.resumeQueue = [];
    for (const chunk of queued) {
      if (this.lastSeq !== null && chunk.seq <= this.lastSeq) continue;
      this.lastSeq = chunk.seq;
      this.handlers.onOutput(chunk.data, chunk.seq);
    }
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
    } else if (t === "resize") {
      const { cols, rows } = msg as { cols?: unknown; rows?: unknown };
      if (typeof cols === "number" && typeof rows === "number") {
        this.handlers.onResize(cols, rows);
      }
    } else if (t === "exit") {
      // The child exited: the server's follow-up normal close must NOT trigger a
      // reconnect to a dead session. Mark the socket gone before the close lands.
      this.gone = true;
      this.clearProbe();
      this.setReconnecting(false);
      const code = (msg as { exitCode?: unknown }).exitCode;
      this.handlers.onExit(typeof code === "number" ? code : null);
    }
    // Unknown/missing tags (a `pong` among them — it says all it has to say by
    // arriving) are ignored.
  }
}
