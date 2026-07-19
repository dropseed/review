import { vi, describe, it, expect, beforeEach } from "vitest";
import type { SearchMatch } from "../../types";

const { searchFileContents } = vi.hoisted(() => ({
  searchFileContents: vi.fn(),
}));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform — these tests drive
// pure store logic, and only the search call is asserted.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      { searchFileContents },
      { get: (target, prop) => target[prop as never] ?? (() => () => {}) },
    ),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../index";

const matches: SearchMatch[] = [
  {
    filePath: "a.ts",
    lineNumber: 1,
    column: 0,
    lineContent: "match",
    verified: "unknown",
  },
];

beforeEach(() => {
  searchFileContents.mockReset();
  useReviewStore.setState({
    repoPath: "/repo-a",
    searchQuery: "foo",
    searchResults: [],
    searchLoading: false,
    searchError: null,
    searchCaseSensitive: false,
  } as never);
});

describe("performSearch", () => {
  it("discards a response that resolves after the query changed", async () => {
    let resolveFetch: (value: SearchMatch[]) => void;
    searchFileContents.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const promise = useReviewStore.getState().performSearch("foo");

    // Simulate the user typing a new query while the request is in flight.
    useReviewStore.getState().setSearchQuery("bar");

    resolveFetch!(matches);
    await promise;

    const state = useReviewStore.getState();
    expect(state.searchResults).toEqual([]);
    expect(state.searchLoading).toBe(true);
  });

  it("discards a response that resolves after the repo changed", async () => {
    let resolveFetch: (value: SearchMatch[]) => void;
    searchFileContents.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const promise = useReviewStore.getState().performSearch("foo");

    useReviewStore.setState({ repoPath: "/repo-b" } as never);

    resolveFetch!(matches);
    await promise;

    const state = useReviewStore.getState();
    expect(state.searchResults).toEqual([]);
  });

  it("applies the response when the query and repo haven't changed", async () => {
    searchFileContents.mockResolvedValue(matches);

    await useReviewStore.getState().performSearch("foo");

    const state = useReviewStore.getState();
    expect(state.searchResults).toEqual(matches);
    expect(state.searchLoading).toBe(false);
  });
});
