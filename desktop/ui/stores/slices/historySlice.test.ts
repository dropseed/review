import { vi, describe, it, expect, beforeEach } from "vitest";

const { getHunkAttribution } = vi.hoisted(() => ({
  getHunkAttribution: vi.fn(),
}));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform — these tests drive
// pure store logic, and only the attribution call is asserted.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      { getHunkAttribution },
      { get: (target, prop) => target[prop as never] ?? (() => () => {}) },
    ),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../index";

beforeEach(() => {
  getHunkAttribution.mockReset();
  // Attribution memoizes across reviews, so each test starts from a cold cache.
  useReviewStore.getState().invalidateAttribution();
  useReviewStore.setState({
    repoPath: "/repo-a",
    comparison: { key: "a..b", base: "a", head: "b" },
    attribution: null,
    attributionLoading: false,
    attributionLoaded: false,
  } as never);
});

describe("loadAttribution", () => {
  it("discards a response that resolves after the comparison changed", async () => {
    let resolveFetch: (value: unknown) => void;
    getHunkAttribution.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const promise = useReviewStore
      .getState()
      .loadAttribution("/repo-a", "a", "b");

    // Simulate switching to a different comparison while the request is in flight.
    useReviewStore.setState({
      comparison: { key: "c..d", base: "c", head: "d" },
      attribution: null,
      attributionLoading: false,
      attributionLoaded: false,
    } as never);

    resolveFetch!({ commits: [] });
    await promise;

    const state = useReviewStore.getState();
    expect(state.attribution).toBeNull();
    expect(state.attributionLoaded).toBe(false);
  });

  it("applies the response when the comparison hasn't changed", async () => {
    getHunkAttribution.mockResolvedValue({ commits: ["deadbeef"] });

    await useReviewStore.getState().loadAttribution("/repo-a", "a", "b");

    const state = useReviewStore.getState();
    expect(state.attribution).toEqual({ commits: ["deadbeef"] });
    expect(state.attributionLoading).toBe(false);
    expect(state.attributionLoaded).toBe(true);
  });

  it("discards a rejection that resolves after the comparison changed", async () => {
    let rejectFetch: (err: unknown) => void;
    getHunkAttribution.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );

    const promise = useReviewStore
      .getState()
      .loadAttribution("/repo-a", "a", "b");

    // Simulate switching to a different comparison while the request is in flight.
    useReviewStore.setState({
      comparison: { key: "c..d", base: "c", head: "d" },
      attribution: null,
      attributionLoading: false,
      attributionLoaded: false,
    } as never);

    rejectFetch!(new Error("network error"));
    await promise;

    const state = useReviewStore.getState();
    expect(state.attributionLoading).toBe(false);
    expect(state.attributionLoaded).toBe(false);
  });

  it("settles loading/loaded when the comparison hasn't changed and the fetch fails", async () => {
    getHunkAttribution.mockRejectedValue(new Error("network error"));

    await useReviewStore.getState().loadAttribution("/repo-a", "a", "b");

    const state = useReviewStore.getState();
    expect(state.attributionLoading).toBe(false);
    expect(state.attributionLoaded).toBe(true);
  });

  it("serves a repeat visit from the cache until it is invalidated", async () => {
    getHunkAttribution.mockResolvedValue({ commits: ["deadbeef"] });

    await useReviewStore.getState().loadAttribution("/repo-a", "a", "b");
    // Switching away and back is the case this exists for.
    useReviewStore.setState({ attribution: null, attributionLoaded: false });
    await useReviewStore.getState().loadAttribution("/repo-a", "a", "b");

    expect(getHunkAttribution).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState().attribution).toEqual({
      commits: ["deadbeef"],
    });

    useReviewStore.getState().invalidateAttribution("/repo-a");
    await useReviewStore.getState().loadAttribution("/repo-a", "a", "b");

    expect(getHunkAttribution).toHaveBeenCalledTimes(2);
  });

  it("leaves other repos cached when one repo's diff moves", async () => {
    getHunkAttribution.mockResolvedValue({ commits: [] });

    await useReviewStore.getState().loadAttribution("/repo-a", "a", "b");
    await useReviewStore.getState().loadAttribution("/repo-b", "a", "b");
    useReviewStore.getState().invalidateAttribution("/repo-b");

    await useReviewStore.getState().loadAttribution("/repo-a", "a", "b");

    // Only /repo-b had to be re-derived.
    expect(getHunkAttribution).toHaveBeenCalledTimes(2);
  });
});
