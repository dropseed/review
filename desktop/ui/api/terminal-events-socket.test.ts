import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TerminalEventsSocket,
  type TerminalEventsSocketHandlers,
} from "./terminal-events-socket";
import type {
  TerminalExit,
  TerminalRemoved,
  TerminalResized,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalWorkspaceAssigned,
} from "../types";
import {
  FakeWebSocket,
  fakeWebSocketImpl,
  terminalSession,
  terminalStatus,
} from "../test/fixtures";

interface Captured {
  started: TerminalSessionInfo[];
  status: TerminalStatus[];
  resized: TerminalResized[];
  assigned: TerminalWorkspaceAssigned[];
  exited: TerminalExit[];
  removed: TerminalRemoved[];
  invalidated: number;
  handlers: TerminalEventsSocketHandlers;
}

function capture(): Captured {
  const cap: Captured = {
    started: [],
    status: [],
    resized: [],
    assigned: [],
    exited: [],
    removed: [],
    invalidated: 0,
    handlers: undefined as never,
  };
  cap.handlers = {
    onStarted: (s) => cap.started.push(s),
    onStatus: (s) => cap.status.push(s),
    onResized: (r) => cap.resized.push(r),
    onWorkspaceAssigned: (a) => cap.assigned.push(a),
    onExited: (e) => cap.exited.push(e),
    onRemoved: (r) => cap.removed.push(r),
    onInvalidated: () => {
      cap.invalidated += 1;
    },
  };
  return cap;
}

function makeSocket(cap: Captured): TerminalEventsSocket {
  return new TerminalEventsSocket(cap.handlers, {
    webSocketImpl: fakeWebSocketImpl,
    rand: () => 0.5,
    url: () => "ws://test.local/api/terminal/events",
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalEventsSocket", () => {
  it("connects once however many times it is asked to", () => {
    const cap = capture();
    const socket = makeSocket(cap);
    socket.connect();
    socket.connect();
    socket.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.close();
  });

  // Nothing that happened before the socket came up was announced to us, so
  // connecting is itself the news that the list may be stale.
  it("invalidates on the first connect and on every reconnect", () => {
    const cap = capture();
    const socket = makeSocket(cap);
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    expect(cap.invalidated).toBe(1);

    FakeWebSocket.last().serverClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last().simulateOpen();
    expect(cap.invalidated).toBe(2);
    socket.close();
  });

  // The daemon dropped frames for a subscriber that fell behind. The channel
  // keeps running; only the list has to be re-read.
  it("invalidates on `lagged` without reconnecting", () => {
    const cap = capture();
    const socket = makeSocket(cap);
    socket.connect();
    FakeWebSocket.last().simulateOpen();

    FakeWebSocket.last().emitText({ event: "lagged" });

    expect(cap.invalidated).toBe(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.close();
  });

  it("decodes each event, translating `terminalId` to `id`", () => {
    const cap = capture();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();

    const session = terminalSession("t1", { workspaceId: "ws-a" });
    const status = terminalStatus("working", { id: "t1" });
    ws.emitText({ event: "started", session });
    ws.emitText({ event: "status", status });
    ws.emitText({ event: "resized", terminalId: "t1", cols: 100, rows: 40 });
    ws.emitText({
      event: "workspaceAssigned",
      terminalId: "t1",
      workspaceId: "ws-b",
    });
    ws.emitText({ event: "exited", terminalId: "t1", exitCode: 3 });
    ws.emitText({ event: "removed", terminalId: "t1" });

    expect(cap.started).toEqual([session]);
    expect(cap.status).toEqual([status]);
    expect(cap.resized).toEqual([{ id: "t1", cols: 100, rows: 40 }]);
    expect(cap.assigned).toEqual([{ id: "t1", workspaceId: "ws-b" }]);
    expect(cap.exited).toEqual([{ id: "t1", exitCode: 3 }]);
    expect(cap.removed).toEqual([{ id: "t1" }]);
    socket.close();
  });

  // Both are real answers on the wire, and both mean "there isn't one".
  it("reads a null workspace and a null exit code as null", () => {
    const cap = capture();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();

    ws.emitText({
      event: "workspaceAssigned",
      terminalId: "t1",
      workspaceId: null,
    });
    ws.emitText({ event: "exited", terminalId: "t1", exitCode: null });

    expect(cap.assigned).toEqual([{ id: "t1", workspaceId: null }]);
    expect(cap.exited).toEqual([{ id: "t1", exitCode: null }]);
    socket.close();
  });

  // The wire is additive by design: a daemon newer than this client will send
  // frames it has never heard of, and they have to cost nothing.
  it("ignores malformed and unknown frames", () => {
    const cap = capture();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();

    ws.emitText("not json at all");
    ws.emitText({ event: "somethingNewer", whatever: 1 });
    ws.emitText({ event: "started" }); // no session
    ws.emitText({ event: "removed" }); // no id
    ws.emitText({ event: "resized", terminalId: "t1", cols: "wide", rows: 40 });

    expect(cap.started).toEqual([]);
    expect(cap.removed).toEqual([]);
    expect(cap.resized).toEqual([]);
    expect(cap.invalidated).toBe(1); // the connect, and nothing since
    socket.close();
  });

  // A close is this client losing the channel, never a session ending.
  it("stops reconnecting once closed by the caller", () => {
    const cap = capture();
    const socket = makeSocket(cap);
    socket.connect();
    FakeWebSocket.last().simulateOpen();

    socket.close();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
