import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TerminalSocket,
  SESSION_GONE_CODE,
  type TerminalSocketHandlers,
} from "./terminal-socket";
import type { TerminalStatus } from "../types";
import {
  FakeWebSocket,
  fakeWebSocketImpl,
  terminalStatus,
} from "../test/fixtures";

function makeStatus(overrides: Partial<TerminalStatus> = {}): TerminalStatus {
  return terminalStatus("working", {
    runningCommand: "vim",
    cwd: "/repo",
    title: "vim",
    enteredStateAt: 123,
    shellIntegrationActive: true,
    ...overrides,
  });
}

interface Captured {
  output: Uint8Array[];
  outputSeq: number[];
  status: TerminalStatus[];
  exit: Array<number | null>;
  resized: Array<{ cols: number; rows: number }>;
  handlers: TerminalSocketHandlers;
}

function captureHandlers(): Captured {
  const output: Uint8Array[] = [];
  const outputSeq: number[] = [];
  const status: TerminalStatus[] = [];
  const exit: Array<number | null> = [];
  const resized: Array<{ cols: number; rows: number }> = [];
  return {
    output,
    outputSeq,
    status,
    exit,
    resized,
    handlers: {
      onOutput: (data, seq) => {
        output.push(data);
        outputSeq.push(seq);
      },
      onStatus: (s) => status.push(s),
      onExit: (code) => exit.push(code),
      onResize: (cols, rows) => resized.push({ cols, rows }),
    },
  };
}

function makeSocket(
  cap: Captured,
  opts: { rand?: () => number } = {},
): TerminalSocket {
  return new TerminalSocket("t1", cap.handlers, {
    webSocketImpl: fakeWebSocketImpl,
    rand: opts.rand ?? (() => 0.5),
    url: () => "ws://test.local/api/terminal/t1/ws",
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
});

describe("TerminalSocket frame routing", () => {
  it("connects with an arraybuffer binaryType through the id-scoped URL", () => {
    const cap = captureHandlers();
    makeSocket(cap).connect();
    const ws = FakeWebSocket.last();
    expect(ws.binaryType).toBe("arraybuffer");
    expect(ws.url).toBe("ws://test.local/api/terminal/t1/ws");
  });

  it("strips the 8-byte seq header and delivers the remaining bytes + cursor", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    ws.emitBinary(new Uint8Array([1, 2, 3]), 3);
    ws.emitBinary(new Uint8Array([4, 5, 6]), 9);
    expect(cap.output.map((b) => Array.from(b))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(cap.outputSeq).toEqual([3, 9]);
  });

  it("drops binary frames shorter than the 8-byte header", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    ws.emitRawBinary(new ArrayBuffer(4)); // too short to hold a seq header
    expect(cap.output).toHaveLength(0);
  });

  it("routes status text frames to onStatus", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    const status = makeStatus();
    ws.emitText({ t: "status", ...status });
    expect(cap.status).toHaveLength(1);
    expect(cap.status[0].phase).toBe("working");
    expect(cap.status[0].id).toBe("t1");
  });

  it("routes exit text frames to onExit", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.emitText({ t: "exit", exitCode: 137 });
    ws.emitText({ t: "exit", exitCode: null });
    expect(cap.exit).toEqual([137, null]);
  });

  it("routes resize text frames to onResize, dropping malformed sizes", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.emitText({ t: "resize", cols: 141, rows: 52 });
    ws.emitText({ t: "resize", cols: "141" }); // malformed
    expect(cap.resized).toEqual([{ cols: 141, rows: 52 }]);
  });

  it("drops malformed text frames without throwing", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    expect(() => ws.emitText("{not json")).not.toThrow();
    expect(() => ws.emitText("42")).not.toThrow(); // valid JSON, not an object
    expect(() => ws.emitText({ t: "unknown" })).not.toThrow();
    expect(cap.status).toHaveLength(0);
    expect(cap.exit).toHaveLength(0);
  });
});

describe("TerminalSocket reconnect lifecycle", () => {
  it("stops retrying and emits a null exit on a 4404 close", () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap);
      socket.connect();
      const openCount = FakeWebSocket.instances.length;
      FakeWebSocket.last().serverClose(SESSION_GONE_CODE);
      vi.runAllTimers();
      expect(cap.exit).toEqual([null]);
      expect(FakeWebSocket.instances.length).toBe(openCount); // no reconnect
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying after an exit frame and its trailing normal close", () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap);
      socket.connect();
      const ws = FakeWebSocket.last();
      ws.simulateOpen();
      // Server sends the exit frame, then a normal close (1000).
      ws.emitText({ t: "exit", exitCode: 0 });
      const openCount = FakeWebSocket.instances.length;
      ws.serverClose(1000);
      vi.runAllTimers();
      expect(cap.exit).toEqual([0]); // exactly one exit, from the frame
      expect(FakeWebSocket.instances.length).toBe(openCount); // no reconnect
      // Sends after the session is gone are dropped.
      socket.sendInput("x");
      expect(ws.sent).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reconnect after an explicit close()", () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap);
      socket.connect();
      const openCount = FakeWebSocket.instances.length;
      socket.close();
      // A close event arriving after teardown must not schedule a reconnect.
      vi.runAllTimers();
      expect(FakeWebSocket.instances.length).toBe(openCount);
      expect(cap.exit).toHaveLength(0);
      // connect() after an explicit close stays a no-op.
      socket.connect();
      expect(FakeWebSocket.instances.length).toBe(openCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects on an unexpected close with a capped, growing backoff", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap, { rand: () => 1 }); // no jitter → ceiling
      socket.connect();

      const delays: number[] = [];
      for (let i = 0; i < 5; i++) {
        FakeWebSocket.last().serverClose(1006);
        const calls = setTimeoutSpy.mock.calls;
        const call = calls[calls.length - 1];
        delays.push(call?.[1] as number);
        vi.runOnlyPendingTimers();
      }
      // 500, 1000, 2000, 4000, then capped at 8000.
      expect(delays).toEqual([500, 1000, 2000, 4000, 8000]);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("TerminalSocket send helpers", () => {
  it("encodes stdin as UTF-8 binary frames", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    socket.sendInput("café ✓");
    expect(ws.sent).toHaveLength(1);
    const frame = ws.sent[0] as Uint8Array;
    expect(Array.from(frame)).toEqual(
      Array.from(new TextEncoder().encode("café ✓")),
    );
  });

  it("sends resize as a tagged text frame", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    socket.sendResize(120, 40);
    expect(ws.sent[0]).toBe(
      JSON.stringify({ t: "resize", cols: 120, rows: 40 }),
    );
  });

  it("does not send while the socket is not open", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect(); // CONNECTING, not OPEN
    const ws = FakeWebSocket.last();
    socket.sendInput("x");
    socket.sendResize(80, 24);
    expect(ws.sent).toHaveLength(0);
    expect(socket.isOpen()).toBe(false);
  });
});

describe("TerminalSocket.connect idempotency", () => {
  it("does not open a second socket while one is already live", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    socket.connect();
    expect(FakeWebSocket.instances.length).toBe(1);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
