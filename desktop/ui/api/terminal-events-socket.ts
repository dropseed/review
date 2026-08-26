/**
 * TerminalEventsSocket — the web-mode announcement channel.
 *
 * One socket per client, wrapping `GET /api/terminal/events`. It is the
 * counterpart of the daemon's events channel: everything that changes the
 * session list or a session's status, size or workspace arrives here, for every
 * session, whether or not this window has a pane on it. `TerminalSocket` stays
 * what it is — the per-session PTY transport for a *mounted* pane.
 *
 *   server → client  Text = one daemon `Event` verbatim, tagged by `event`:
 *                    `started` | `status` | `resized` | `workspaceAssigned` |
 *                    `exited` | `removed` | `lagged`
 *   client → server  nothing; the channel is one-way.
 *
 * The wire says `terminalId` where the app's payload types say `id`; the
 * translation happens here, at the one boundary that knows both, so the rest of
 * the app sees the same shapes the Tauri transport delivers.
 *
 * A close is never a session ending — it is this *client* losing the
 * announcement channel — so every close reconnects, on the same backoff
 * `TerminalSocket` uses. Reconnecting is also the moment the list is least
 * trustworthy: whatever happened while the socket was down was announced to
 * nobody. So `onInvalidated` fires on every connect, the first included, and on
 * a `lagged` frame, which is the daemon saying the same thing about a
 * subscriber that fell behind.
 */

import type {
  TerminalExit,
  TerminalRemoved,
  TerminalResized,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalWorkspaceAssigned,
} from "../types";
import {
  ReconnectingSocket,
  wsUrl,
  type ReconnectingSocketOptions,
} from "./reconnecting-socket";

/** Callbacks the socket fans decoded events into. */
export interface TerminalEventsSocketHandlers {
  onStarted: (session: TerminalSessionInfo) => void;
  onStatus: (status: TerminalStatus) => void;
  onResized: (resized: TerminalResized) => void;
  onWorkspaceAssigned: (assignment: TerminalWorkspaceAssigned) => void;
  onExited: (exit: TerminalExit) => void;
  onRemoved: (removal: TerminalRemoved) => void;
  /** The session list may have missed something: re-list. */
  onInvalidated: () => void;
}

export type TerminalEventsSocketOptions = ReconnectingSocketOptions;

export class TerminalEventsSocket extends ReconnectingSocket {
  constructor(
    private readonly handlers: TerminalEventsSocketHandlers,
    options: TerminalEventsSocketOptions = {},
  ) {
    super(options);
  }

  // ----- ReconnectingSocket policy -----

  protected defaultUrl(): string {
    return wsUrl("/api/terminal/events");
  }

  protected handleOpen(): void {
    // Nothing that happened before this frame was announced to us.
    this.handlers.onInvalidated();
  }

  protected handleMessage(ev: MessageEvent): void {
    if (typeof ev.data === "string") this.handleText(ev.data);
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
    const frame = msg as Record<string, unknown>;
    switch (frame.event) {
      case "started": {
        const session = frame.session;
        if (session && typeof session === "object") {
          this.handlers.onStarted(session as TerminalSessionInfo);
        }
        return;
      }
      case "status": {
        const status = frame.status;
        if (status && typeof status === "object") {
          this.handlers.onStatus(status as TerminalStatus);
        }
        return;
      }
      case "resized": {
        const { terminalId, cols, rows } = frame;
        if (
          typeof terminalId === "string" &&
          typeof cols === "number" &&
          typeof rows === "number"
        ) {
          this.handlers.onResized({ id: terminalId, cols, rows });
        }
        return;
      }
      case "workspaceAssigned": {
        const { terminalId, workspaceId } = frame;
        if (typeof terminalId !== "string") return;
        this.handlers.onWorkspaceAssigned({
          id: terminalId,
          workspaceId: typeof workspaceId === "string" ? workspaceId : null,
        });
        return;
      }
      case "exited": {
        const { terminalId, exitCode } = frame;
        if (typeof terminalId !== "string") return;
        this.handlers.onExited({
          id: terminalId,
          exitCode: typeof exitCode === "number" ? exitCode : null,
        });
        return;
      }
      case "removed": {
        const { terminalId } = frame;
        if (typeof terminalId === "string") {
          this.handlers.onRemoved({ id: terminalId });
        }
        return;
      }
      case "lagged":
        // Events were dropped for this subscriber. The channel keeps running;
        // only the list has to be re-read.
        this.handlers.onInvalidated();
        return;
      default:
        // Unknown tags are ignored — the wire is additive by design.
        return;
    }
  }
}
