import { vi, describe, it, expect, beforeEach } from "vitest";

const { getRepoSymbols } = vi.hoisted(() => ({
  getRepoSymbols: vi.fn(),
}));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform — these tests drive
// pure store logic, and only the repo-symbols call is asserted.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      { getRepoSymbols },
      { get: (target, prop) => target[prop as never] ?? (() => () => {}) },
    ),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../index";
import { repoSymbolsResetState } from "./symbolsSlice";

beforeEach(() => {
  getRepoSymbols.mockReset();
  useReviewStore.setState({
    repoPath: "/repo-a",
    ...repoSymbolsResetState,
  } as never);
});

describe("loadRepoSymbols", () => {
  it("discards a response that resolves after the repo changed", async () => {
    let resolveFetch: (value: unknown) => void;
    getRepoSymbols.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const promise = useReviewStore.getState().loadRepoSymbols();

    // Simulate switching to a different repo while the request is in flight.
    useReviewStore.setState({
      repoPath: "/repo-b",
      ...repoSymbolsResetState,
    } as never);

    resolveFetch!([{ path: "old.ts", symbols: [] }]);
    await promise;

    const state = useReviewStore.getState();
    expect(state.repoSymbols).toEqual([]);
    expect(state.repoSymbolsLoaded).toBe(false);
  });

  it("applies the response when the repo hasn't changed", async () => {
    getRepoSymbols.mockResolvedValue([{ path: "a.ts", symbols: [] }]);

    await useReviewStore.getState().loadRepoSymbols();

    const state = useReviewStore.getState();
    expect(state.repoSymbols).toEqual([{ path: "a.ts", symbols: [] }]);
    expect(state.repoSymbolsLoading).toBe(false);
    expect(state.repoSymbolsLoaded).toBe(true);
  });

  it("discards a rejection that resolves after the repo changed", async () => {
    let rejectFetch: (err: unknown) => void;
    getRepoSymbols.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );

    const promise = useReviewStore.getState().loadRepoSymbols();

    // Simulate switching to a different repo while the request is in flight.
    useReviewStore.setState({
      repoPath: "/repo-b",
      ...repoSymbolsResetState,
    } as never);

    rejectFetch!(new Error("network error"));
    await promise;

    const state = useReviewStore.getState();
    expect(state.repoSymbolsLoading).toBe(false);
    expect(state.repoSymbolsLoaded).toBe(false);
  });

  it("settles loading/loaded when the repo hasn't changed and the fetch fails", async () => {
    getRepoSymbols.mockRejectedValue(new Error("network error"));

    await useReviewStore.getState().loadRepoSymbols();

    const state = useReviewStore.getState();
    expect(state.repoSymbolsLoading).toBe(false);
    expect(state.repoSymbolsLoaded).toBe(true);
  });
});
