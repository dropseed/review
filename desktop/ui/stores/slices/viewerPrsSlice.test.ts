import { describe, it, expect, vi, afterEach } from "vitest";
import { createViewerPrsSlice, type ViewerPrsSlice } from "./viewerPrsSlice";
import type { ApiClient } from "../../api";
import type { ViewerPrSnapshot } from "../../types";

function snapshot(overrides: Partial<ViewerPrSnapshot> = {}): ViewerPrSnapshot {
  return {
    fetchedAt: "2026-01-20T00:00:00.000Z",
    prs: [],
    truncated: false,
    error: null,
    available: true,
    ...overrides,
  };
}

/**
 * The slice on its own — no store. It needs nothing from the other slices, and
 * the ordering token it keeps lives in the creator's closure, which is exactly
 * what these tests are about.
 */
function makeSlice(
  getViewerPrs: (refresh: boolean) => Promise<ViewerPrSnapshot>,
) {
  let state = {} as ViewerPrsSlice;
  const set = (partial: Partial<ViewerPrsSlice>): void => {
    state = { ...state, ...partial };
  };
  const client = { getViewerPrs } as unknown as ApiClient;
  const creator = createViewerPrsSlice(client) as unknown as (
    set: (partial: Partial<ViewerPrsSlice>) => void,
    get: () => ViewerPrsSlice,
  ) => ViewerPrsSlice;
  state = creator(set, () => state);
  return {
    state: () => state,
    load: () => state.loadViewerPrs(),
    refresh: () => state.refreshViewerPrs(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("refreshViewerPrs", () => {
  it("gives up on a refresh that never settles, and stays refreshable", async () => {
    vi.useFakeTimers();
    const slice = makeSlice(() => new Promise<ViewerPrSnapshot>(() => {}));

    const pending = slice.refresh();
    expect(slice.state().viewerPrsRefreshing).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    // The guard clearing is the point: a hung invoke that left it set would
    // make every later refresh return early for the life of the window.
    expect(slice.state().viewerPrsRefreshing).toBe(false);
    expect(slice.state().viewerPrs?.error).toMatch(/timed out/i);
  });

  it("keeps the previous PRs when the call itself fails", async () => {
    const prior = snapshot({ truncated: true });
    const slice = makeSlice(
      vi
        .fn<(refresh: boolean) => Promise<ViewerPrSnapshot>>()
        .mockResolvedValueOnce(prior)
        .mockRejectedValueOnce(new Error("gh exploded")),
    );

    await slice.load();
    await slice.refresh();

    expect(slice.state().viewerPrs).toEqual({
      ...prior,
      error: "gh exploded",
    });
  });

  it("lets a newer snapshot win over a slower older read", async () => {
    const slow = deferred<ViewerPrSnapshot>();
    const stale = snapshot({ fetchedAt: "2026-01-19T00:00:00.000Z" });
    const fresh = snapshot({ fetchedAt: "2026-01-20T12:00:00.000Z" });

    const slice = makeSlice((refresh) =>
      refresh ? Promise.resolve(fresh) : slow.promise,
    );

    const cacheRead = slice.load();
    await slice.refresh();
    expect(slice.state().viewerPrs).toBe(fresh);

    slow.resolve(stale);
    await cacheRead;
    expect(slice.state().viewerPrs).toBe(fresh);
  });
});
