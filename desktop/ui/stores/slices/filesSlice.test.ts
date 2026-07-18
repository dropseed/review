import { vi, describe, it, expect, beforeEach } from "vitest";
import type { FileEntry } from "../../types";

const { listDirectoryContents } = vi.hoisted(() => ({
  listDirectoryContents: vi.fn(),
}));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform — these tests drive
// pure store logic, and only the directory-listing call is asserted.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      { listDirectoryContents },
      { get: (target, prop) => target[prop as never] ?? (() => () => {}) },
    ),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../index";

const baseTree: FileEntry[] = [
  { name: "vendor", path: "vendor", isDirectory: true, children: [] },
];

beforeEach(() => {
  listDirectoryContents.mockReset();
  useReviewStore.setState({
    repoPath: "/repo-a",
    allFiles: baseTree,
    loadedGitIgnoredDirs: new Set<string>(),
  } as never);
});

describe("loadDirectoryContents", () => {
  it("discards a response that resolves after the repo changed", async () => {
    let resolveFetch: (value: FileEntry[]) => void;
    listDirectoryContents.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const promise = useReviewStore.getState().loadDirectoryContents("vendor");

    // Simulate switching to a different repo while the request is in flight.
    useReviewStore.setState({
      repoPath: "/repo-b",
      allFiles: [],
      loadedGitIgnoredDirs: new Set<string>(),
    } as never);

    resolveFetch!([{ name: "pkg", path: "vendor/pkg", isDirectory: true }]);
    await promise;

    const state = useReviewStore.getState();
    expect(state.allFiles).toEqual([]);
    expect(state.loadedGitIgnoredDirs.has("vendor")).toBe(false);
  });

  it("applies the response when the repo hasn't changed", async () => {
    listDirectoryContents.mockResolvedValue([
      { name: "pkg", path: "vendor/pkg", isDirectory: true },
    ]);

    await useReviewStore.getState().loadDirectoryContents("vendor");

    const state = useReviewStore.getState();
    expect(state.allFiles).toEqual([
      {
        name: "vendor",
        path: "vendor",
        isDirectory: true,
        children: [{ name: "pkg", path: "vendor/pkg", isDirectory: true }],
      },
    ]);
    expect(state.loadedGitIgnoredDirs.has("vendor")).toBe(true);
  });
});
