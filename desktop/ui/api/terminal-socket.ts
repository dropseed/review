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
 *                             the shared PTY) | `{"t":"exit"}`
 *   client → server  Binary = stdin bytes; Text = `{"t":"resize","cols","rows"}`
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
 */

import type { TerminalStatus } from "../types";
import {
  ReconnectingSocket,
  wsUrl,
  type ReconnectingSocketOptions,
} from "./reconnecting-socket";

/** Close code the server uses to signal the session no longer exists. */
export const SESSION_GONE_CODE = 4404;

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

export type TerminalSocketOptions = ReconnectingSocketOptions;

export class TerminalSocket extends ReconnectingSocket {
  constructor(
    private readonly id: string,
    private readonly handlers: TerminalSocketHandlers,
    options: TerminalSocketOptions = {},
  ) {
    super(options);
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

  // ----- ReconnectingSocket policy -----

  protected defaultUrl(): string {
    return wsUrl(`/api/terminal/${this.id}/ws`);
  }

  protected configure(ws: WebSocket): void {
    ws.binaryType = "arraybuffer";
  }

  protected handleMessage(ev: MessageEvent): void {
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

  protected shouldReconnect(ev: CloseEvent): boolean {
    if (ev.code !== SESSION_GONE_CODE) return true;
    this.gone = true;
    this.handlers.onExit(null);
    return false;
  }

  // ----- Internals -----

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
      const code = (msg as { exitCode?: unknown }).exitCode;
      this.handlers.onExit(typeof code === "number" ? code : null);
    }
    // Unknown/missing tags are ignored.
  }
}
