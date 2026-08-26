import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TerminalSocket,
  PROBE_TIMEOUT_MS,
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
  opts: {
    rand?: () => number;
    fetchReplay?: (id: string) => Promise<{ data: Uint8Array; cursor: number }>;
  } = {},
): TerminalSocket {
  return new TerminalSocket("t1", cap.handlers, {
    webSocketImpl: fakeWebSocketImpl,
    rand: opts.rand ?? (() => 0.5),
    url: () => "ws://test.local/api/terminal/t1/ws",
    fetchReplay: opts.fetchReplay,
  });
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

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

/**
 * The iOS PWA case: the tab is backgrounded, its socket suspended, and the
 * pane must be current and honest within a frame or two of coming back.
 */
describe("TerminalSocket.wake", () => {
  it("reconnects immediately, discarding a pending backoff delay", () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap);
      socket.connect();
      FakeWebSocket.last().simulateOpen();
      FakeWebSocket.last().serverClose(1006); // backoff scheduled
      expect(FakeWebSocket.instances.length).toBe(1);

      socket.wake();
      expect(FakeWebSocket.instances.length).toBe(2);

      // The delay that was pending must not fire a *second* socket behind it.
      vi.runOnlyPendingTimers();
      expect(FakeWebSocket.instances.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the backoff, so a later failure starts from 500ms again", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap, { rand: () => 1 });
      socket.connect();
      for (let i = 0; i < 3; i++) {
        FakeWebSocket.last().serverClose(1006);
        vi.runOnlyPendingTimers();
      }
      socket.wake(); // not open → immediate reconnect, attempts reset
      setTimeoutSpy.mockClear();
      FakeWebSocket.last().serverClose(1006);
      const call =
        setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      expect(call?.[1]).toBe(500);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("probes an open socket and reconnects when nothing answers", () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap);
      socket.connect();
      const ws = FakeWebSocket.last();
      ws.simulateOpen();

      socket.wake();
      expect(ws.sent).toEqual([JSON.stringify({ t: "ping" })]);
      expect(FakeWebSocket.instances.length).toBe(1); // still trusting it

      vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
      expect(FakeWebSocket.instances.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a socket that answers the probe — any frame is proof of life", () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const socket = makeSocket(cap);
      socket.connect();
      const ws = FakeWebSocket.last();
      ws.simulateOpen();

      socket.wake();
      ws.emitText({ t: "pong" });
      vi.advanceTimersByTime(PROBE_TIMEOUT_MS * 2);

      expect(FakeWebSocket.instances.length).toBe(1);
      // A pong is not a status, an exit, or a resize.
      expect(cap.status).toEqual([]);
      expect(cap.exit).toEqual([]);
      expect(cap.resized).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet once the session is gone", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    socket.connect();
    FakeWebSocket.last().serverClose(SESSION_GONE_CODE);
    socket.wake();
    expect(FakeWebSocket.instances.length).toBe(1);
  });
});

/**
 * The live stream only ever carries what is happening now, so a socket that
 * was away has to go and get what it missed from the scrollback ring.
 */
describe("TerminalSocket resume-from-cursor", () => {
  it("writes only the bytes past the last seq it delivered", async () => {
    const cap = captureHandlers();
    // The ring holds stream bytes 11..20; this socket last saw byte 15.
    const fetchReplay = vi.fn(async () => ({
      data: utf8("abcdefghij"),
      cursor: 20,
    }));
    const socket = makeSocket(cap, { fetchReplay });
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    FakeWebSocket.last().emitBinary(utf8("live"), 15);
    expect(fetchReplay).not.toHaveBeenCalled(); // nothing missed yet

    FakeWebSocket.last().serverClose(1006);
    socket.wake();
    FakeWebSocket.last().simulateOpen();
    await vi.waitFor(() => expect(cap.output.length).toBe(2));

    expect(text(cap.output[1]!)).toBe("fghij");
    expect(cap.outputSeq[1]).toBe(20);
  });

  it("holds live chunks behind the snapshot and drops the overlap", async () => {
    const cap = captureHandlers();
    let release: (value: {
      data: Uint8Array;
      cursor: number;
    }) => void = () => {};
    const fetchReplay = vi.fn(
      () =>
        new Promise<{ data: Uint8Array; cursor: number }>((resolve) => {
          release = resolve;
        }),
    );
    const socket = makeSocket(cap, { fetchReplay });
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    FakeWebSocket.last().emitBinary(utf8("seen"), 10);

    FakeWebSocket.last().serverClose(1006);
    socket.wake();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();

    // Live output racing the in-flight snapshot: one chunk the snapshot will
    // already contain, one past its end.
    ws.emitBinary(utf8("dup"), 14);
    ws.emitBinary(utf8("new"), 23);
    expect(cap.output.length).toBe(1); // held, not spliced in ahead of it

    release({ data: utf8("abcdefghij"), cursor: 20 });
    await vi.waitFor(() => expect(cap.output.length).toBe(3));

    expect(cap.output.slice(1).map(text)).toEqual(["abcdefghij", "new"]);
    expect(cap.outputSeq.slice(1)).toEqual([20, 23]);
  });

  it("writes the whole snapshot when the gap outran the ring", async () => {
    const cap = captureHandlers();
    const fetchReplay = vi.fn(async () => ({
      data: utf8("what is left"),
      cursor: 9_000,
    }));
    const socket = makeSocket(cap, { fetchReplay });
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    FakeWebSocket.last().emitBinary(utf8("x"), 5);

    FakeWebSocket.last().serverClose(1006);
    socket.wake();
    FakeWebSocket.last().simulateOpen();
    await vi.waitFor(() => expect(cap.output.length).toBe(2));

    expect(text(cap.output[1]!)).toBe("what is left");
  });

  it("resumes from a cursor the owning client fetched out of band", async () => {
    const cap = captureHandlers();
    const fetchReplay = vi.fn(async () => ({
      data: utf8("0123456789"),
      cursor: 10,
    }));
    const socket = makeSocket(cap, { fetchReplay });
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    // The pane's own cold-reattach replay ended at byte 4; no live byte has
    // reached this socket yet, and it still knows where it stands.
    socket.noteCursor(4);

    FakeWebSocket.last().serverClose(1006);
    socket.wake();
    FakeWebSocket.last().simulateOpen();
    await vi.waitFor(() => expect(cap.output.length).toBe(1));
    expect(text(cap.output[0]!)).toBe("456789");
  });

  /**
   * A tab coming back to a socket that never actually broke missed nothing, so
   * it fetches nothing: the ring is one HTTP round trip per session, and an
   * unlock wakes every session at once.
   */
  it("does not refetch for a socket that was open all along", async () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const fetchReplay = vi.fn(async () => ({
        data: utf8("0123456789"),
        cursor: 10,
      }));
      const socket = makeSocket(cap, { fetchReplay });
      socket.connect();
      const ws = FakeWebSocket.last();
      ws.simulateOpen();
      ws.emitBinary(utf8("live"), 4);

      socket.wake();
      ws.emitText({ t: "pong" }); // proof of life
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS * 2);

      expect(fetchReplay).not.toHaveBeenCalled();
      expect(FakeWebSocket.instances.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /** The other half: a probe nothing answers reconnects, and *that* catches up. */
  it("catches up after a probe that went unanswered", async () => {
    vi.useFakeTimers();
    try {
      const cap = captureHandlers();
      const fetchReplay = vi.fn(async () => ({
        data: utf8("0123456789"),
        cursor: 10,
      }));
      const socket = makeSocket(cap, { fetchReplay });
      socket.connect();
      FakeWebSocket.last().simulateOpen();
      FakeWebSocket.last().emitBinary(utf8("live"), 4);

      socket.wake();
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
      expect(FakeWebSocket.instances.length).toBe(2);

      FakeWebSocket.last().simulateOpen();
      await vi.waitFor(() => expect(cap.output.length).toBe(2));
      expect(text(cap.output[1]!)).toBe("456789");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fetch when it has no position to resume from", async () => {
    const cap = captureHandlers();
    const fetchReplay = vi.fn(async () => ({
      data: utf8(""),
      cursor: 0,
    }));
    const socket = makeSocket(cap, { fetchReplay });
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    FakeWebSocket.last().serverClose(1006);
    socket.wake();
    FakeWebSocket.last().simulateOpen();
    await Promise.resolve();
    expect(fetchReplay).not.toHaveBeenCalled();
  });
});

describe("TerminalSocket connection state", () => {
  it("reports the transport, from the first subscribe onwards", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    const seen: boolean[] = [];
    socket.onState((reconnecting) => seen.push(reconnecting));
    expect(seen).toEqual([true]); // not yet connected

    socket.connect();
    FakeWebSocket.last().simulateOpen();
    FakeWebSocket.last().serverClose(1006);
    expect(seen).toEqual([true, false, true]);
  });

  /**
   * A session that is gone is not a connection fact: the pane hears about the
   * exit from `onExit`, and a badge saying "reconnecting" over a dead shell
   * would promise something that is never coming.
   */
  it("stops reporting a gap for a session that has ended", () => {
    for (const end of ["close", "exit"] as const) {
      FakeWebSocket.reset();
      const cap = captureHandlers();
      const socket = makeSocket(cap);
      socket.connect();
      FakeWebSocket.last().simulateOpen();
      if (end === "close") {
        FakeWebSocket.last().serverClose(SESSION_GONE_CODE);
      } else {
        FakeWebSocket.last().emitText({ t: "exit", exitCode: 0 });
      }
      // Subscribed after the ending, so the one value it reports is the
      // socket's settled answer about itself.
      const seen: boolean[] = [];
      socket.onState((reconnecting) => seen.push(reconnecting));
      expect(seen).toEqual([false]);
    }
  });

  it("unsubscribes cleanly", () => {
    const cap = captureHandlers();
    const socket = makeSocket(cap);
    const seen: boolean[] = [];
    const off = socket.onState((reconnecting) => seen.push(reconnecting));
    off();
    socket.connect();
    FakeWebSocket.last().simulateOpen();
    expect(seen).toEqual([true]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
