import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalPeekPoller } from "./peek-poller";

const INTERVAL = 2000;

/** A `peekMany` that records what it was asked and answers from a table. */
function fakePeek(screens: Record<string, string>) {
  const asked: string[][] = [];
  const fn = vi.fn(async (ids: string[]) => {
    asked.push([...ids]);
    const out: Record<string, string> = {};
    for (const id of ids) if (id in screens) out[id] = screens[id]!;
    return out;
  });
  return { fn, asked, screens };
}

/** A promise this test resolves by hand, to hold a request in flight. */
function deferred(): {
  promise: Promise<Record<string, string>>;
  resolve: (screens: Record<string, string>) => void;
} {
  let resolve!: (screens: Record<string, string>) => void;
  const promise = new Promise<Record<string, string>>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let visible = true;

function makePoller(
  peekMany: (ids: string[]) => Promise<Record<string, string>>,
) {
  return new TerminalPeekPoller({
    peekMany,
    intervalMs: INTERVAL,
    isVisible: () => visible,
  });
}

/** Let the immediate-pull timeout fire and its promise settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  visible = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalPeekPoller", () => {
  // The whole reason the batched peek exists: N cards, one call.
  it("asks for every mounted card in one call", async () => {
    const peek = fakePeek({ a: "A", b: "B", c: "C" });
    const poller = makePoller(peek.fn);
    const seen: Record<string, string[]> = { a: [], b: [], c: [] };
    for (const id of ["a", "b", "c"]) {
      poller.subscribe(id, (text) => seen[id]!.push(text));
    }

    await settle();

    expect(peek.fn).toHaveBeenCalledTimes(1);
    expect(peek.asked[0]?.sort()).toEqual(["a", "b", "c"]);
    expect(seen).toEqual({ a: ["A"], b: ["B"], c: ["C"] });
    poller.dispose();
  });

  // A screen that isn't moving must cost no re-renders at all.
  it("delivers only when the screen actually changed", async () => {
    const peek = fakePeek({ a: "same" });
    const poller = makePoller(peek.fn);
    const seen: string[] = [];
    poller.subscribe("a", (text) => seen.push(text));
    await settle();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(peek.fn).toHaveBeenCalledTimes(3);
    expect(seen).toEqual(["same"]);

    peek.screens["a"] = "moved";
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(seen).toEqual(["same", "moved"]);
    poller.dispose();
  });

  // A card that mounts between ticks must not wait out an interval it was
  // never part of — but a burst of them is still one call.
  it("pulls promptly for a new id, coalescing a burst into one call", async () => {
    const peek = fakePeek({ a: "A", b: "B" });
    const poller = makePoller(peek.fn);
    poller.subscribe("a", () => undefined);
    await settle();
    expect(peek.fn).toHaveBeenCalledTimes(1);

    const seenB: string[] = [];
    poller.subscribe("b", (text) => seenB.push(text));
    poller.subscribe("b", () => undefined);
    await settle();

    expect(peek.fn).toHaveBeenCalledTimes(2);
    expect(peek.asked[1]?.sort()).toEqual(["a", "b"]);
    expect(seenB).toEqual(["B"]);
    poller.dispose();
  });

  // A second card for the same session is showing a screen that is current,
  // so it gets it now rather than blank until the next tick.
  it("hands a second subscriber the screen already in hand", async () => {
    const peek = fakePeek({ a: "A" });
    const poller = makePoller(peek.fn);
    poller.subscribe("a", () => undefined);
    await settle();

    const seen: string[] = [];
    poller.subscribe("a", (text) => seen.push(text));

    expect(seen).toEqual(["A"]); // synchronously, before any tick
    poller.dispose();
  });

  // Cards mount and unmount between ticks; a request in flight names ids that
  // may be gone by the time it answers.
  it("drops results for an id whose last card unmounted mid-request", async () => {
    const inFlight = deferred();
    const peekMany = vi.fn(() => inFlight.promise);
    const poller = makePoller(peekMany);
    const seen: string[] = [];
    const unsubscribe = poller.subscribe("a", (text) => seen.push(text));
    await settle();

    unsubscribe();
    inFlight.resolve({ a: "A" });
    await settle();

    expect(seen).toEqual([]);
    poller.dispose();
  });

  // Stopping with the last card is what keeps an idle window idle.
  it("stops polling when the last card unmounts and resumes on the next", async () => {
    const peek = fakePeek({ a: "A" });
    const poller = makePoller(peek.fn);
    const unsubscribe = poller.subscribe("a", () => undefined);
    await settle();
    expect(peek.fn).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(peek.fn).toHaveBeenCalledTimes(1);

    poller.subscribe("a", () => undefined);
    await settle();
    expect(peek.fn).toHaveBeenCalledTimes(2);
    poller.dispose();
  });

  // A backgrounded window pays for nothing: each peek is a round trip and a
  // full VT render, for a screen nobody can look at.
  it("does not poll while the document is hidden", async () => {
    const peek = fakePeek({ a: "A" });
    const poller = makePoller(peek.fn);
    visible = false;
    poller.subscribe("a", () => undefined);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(peek.fn).not.toHaveBeenCalled();

    visible = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(peek.fn).toHaveBeenCalledTimes(1);
    poller.dispose();
  });

  // "Nothing to show" is the honest answer for a session that just died — but
  // only for a card that never had a screen. One that has keeps it.
  it("settles an unanswered id on empty, and keeps a screen it already had", async () => {
    const peek = fakePeek({ a: "A" });
    const poller = makePoller(peek.fn);
    const seenA: string[] = [];
    const seenGone: string[] = [];
    poller.subscribe("a", (text) => seenA.push(text));
    poller.subscribe("gone", (text) => seenGone.push(text));
    await settle();

    expect(seenA).toEqual(["A"]);
    expect(seenGone).toEqual([""]);

    // `a` dies: the daemon stops answering for it, and the card keeps the last
    // thing it said rather than blanking.
    delete peek.screens["a"];
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(seenA).toEqual(["A"]);
    poller.dispose();
  });

  // A failed request is the same fact as an unanswered id.
  it("survives a failed request", async () => {
    const peekMany = vi.fn(() => Promise.reject(new Error("daemon gone")));
    const poller = makePoller(peekMany);
    const seen: string[] = [];
    poller.subscribe("a", (text) => seen.push(text));

    await settle();
    expect(seen).toEqual([""]);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(peekMany).toHaveBeenCalledTimes(2);
    poller.dispose();
  });

  // A slow peek must not stack behind the interval.
  it("keeps at most one request in flight", async () => {
    const inFlight = deferred();
    const peekMany = vi.fn(() => inFlight.promise);
    const poller = makePoller(peekMany);
    poller.subscribe("a", () => undefined);
    await settle();
    expect(peekMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(peekMany).toHaveBeenCalledTimes(1);

    inFlight.resolve({ a: "A" });
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(peekMany).toHaveBeenCalledTimes(2);
    poller.dispose();
  });

  // The cache lives exactly as long as someone is showing the session, so the
  // only way to read one is for it to be current.
  it("forgets a session's screen once nobody is showing it", async () => {
    const peek = fakePeek({ a: "A" });
    const poller = makePoller(peek.fn);
    const unsubscribe = poller.subscribe("a", () => undefined);
    await settle();
    unsubscribe();

    const seen: string[] = [];
    poller.subscribe("a", (text) => seen.push(text));
    expect(seen).toEqual([]); // nothing handed over synchronously
    await settle();
    expect(seen).toEqual(["A"]);
    poller.dispose();
  });
});
