import { vi, describe, it, expect, beforeEach } from "vitest";
import type { FileEntry } from "../../types";
import { makeComparison } from "../../types";

const { listDirectoryContents, listAllFiles, listRepoFiles, listFiles } =
  vi.hoisted(() => ({
    listDirectoryContents: vi.fn(),
    listAllFiles: vi.fn(),
    listRepoFiles: vi.fn(),
    listFiles: vi.fn(),
  }));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform — these tests drive
// pure store logic, and only the directory-listing/all-files calls are
// asserted.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      { listDirectoryContents, listAllFiles, listRepoFiles, listFiles },
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
  listAllFiles.mockReset();
  listRepoFiles.mockReset();
  listFiles.mockReset();
  useReviewStore.setState({
    repoPath: "/repo-a",
    allFiles: baseTree,
    loadedGitIgnoredDirs: new Set<string>(),
    allFilesLoading: false,
  } as never);
});

describe("setCommitRange", () => {
  const range = (base: string, head: string, ordinal: number) => ({
    kind: "commits" as const,
    loOrdinal: ordinal,
    hiOrdinal: ordinal,
    title: `#${ordinal}`,
    comparison: makeComparison(base, head),
  });
  const reviewComparison = {
    base: "main",
    head: "feature",
    key: "main..feature",
  };
  const attribution = { commits: [], hunkCommits: {} };

  const seed = (): void => {
    useReviewStore.setState({
      repoPath: "/repo-a",
      comparison: reviewComparison,
      reviewComparison,
      reviewRef: "feature",
      baseReason: "branchVsDefault",
      commitRange: null,
      attribution,
      attributionLoaded: true,
      files: [{ name: "a.ts", path: "a.ts", isDirectory: false }],
    } as never);
  };

  it("swaps in the range as the comparison but keeps the review's identity", () => {
    seed();
    useReviewStore.getState().setCommitRange(range("main", "sha1", 1));

    const s = useReviewStore.getState();
    expect(s.comparison?.key).toBe("main..sha1");
    expect(s.reviewComparison).toEqual(reviewComparison);
    expect(s.reviewRef).toBe("feature");
    expect(s.baseReason).toBe("branchVsDefault");
    // Stale diff data is cleared so the range re-diffs from scratch.
    expect(s.files).toEqual([]);
  });

  it("keeps commit attribution, which describes the branch and not the range", () => {
    seed();
    useReviewStore.getState().setCommitRange(range("sha1", "sha2", 2));

    // Dropping this would leave the picker offering only the commit already
    // selected, with no way back to the full list.
    const s = useReviewStore.getState();
    expect(s.attribution).toBe(attribution);
    expect(s.attributionLoaded).toBe(true);
  });

  it("restores the review comparison when the range is cleared", () => {
    seed();
    useReviewStore.getState().setCommitRange(range("main", "sha1", 1));
    useReviewStore.getState().setCommitRange(null);

    const s = useReviewStore.getState();
    expect(s.comparison).toEqual(reviewComparison);
    expect(s.commitRange).toBeNull();
  });
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

describe("loadFiles", () => {
  const comparisonA = makeComparison("main", "a");
  const comparisonB = makeComparison("main", "b");

  beforeEach(() => {
    useReviewStore.setState({
      comparison: comparisonA,
      loadingProgress: null,
    } as never);
  });

  it("discards a rejection that resolves after the comparison changed", async () => {
    let rejectFetch: (err: unknown) => void;
    listFiles.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );

    const promise = useReviewStore.getState().loadFiles();

    // Simulate switching comparisons while the request is in flight; the
    // new comparison's own load claims the loading progress and activity.
    useReviewStore.setState({
      comparison: comparisonB,
      loadingProgress: { current: 0, total: 1, phase: "files" },
    } as never);
    useReviewStore.getState().startActivity("load-files", "Loading files", 20);

    rejectFetch!(new Error("network error"));
    await promise;

    const state = useReviewStore.getState();
    expect(state.loadingProgress).toEqual({
      current: 0,
      total: 1,
      phase: "files",
    });
    expect(state.activities.has("load-files")).toBe(true);
  });

  it("settles loading when the comparison hasn't changed and the fetch fails", async () => {
    listFiles.mockRejectedValue(new Error("network error"));

    await useReviewStore.getState().loadFiles();

    expect(useReviewStore.getState().loadingProgress).toBeNull();
  });

  it("discards a success that resolves after the comparison changed", async () => {
    let resolveFetch: (files: FileEntry[]) => void;
    listFiles.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const promise = useReviewStore.getState().loadFiles();

    // Simulate switching comparisons while the request is in flight; the
    // new comparison's own load claims the loading progress and activity.
    useReviewStore.setState({
      comparison: comparisonB,
      loadingProgress: { current: 0, total: 1, phase: "files" },
      files: [],
    } as never);
    useReviewStore.getState().startActivity("load-files", "Loading files", 20);

    resolveFetch!([{ name: "a.ts", path: "a.ts", isDirectory: false }]);
    await promise;

    const state = useReviewStore.getState();
    expect(state.loadingProgress).toEqual({
      current: 0,
      total: 1,
      phase: "files",
    });
    expect(state.activities.has("load-files")).toBe(true);
    expect(state.files).toEqual([]);
  });
});

describe("loadAllFiles", () => {
  const comparison = { base: "main", head: "a", key: "main..a" };

  beforeEach(() => {
    useReviewStore.setState({
      comparison,
      allFilesLoading: false,
    } as never);
  });

  it("discards a rejection that resolves after the comparison changed", async () => {
    let rejectFetch: (err: unknown) => void;
    listAllFiles.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );

    const promise = useReviewStore.getState().loadAllFiles();

    // Simulate switching comparisons while the request is in flight; the
    // new comparison's own load claims the loading flag.
    useReviewStore.setState({
      comparison: { base: "main", head: "b", key: "main..b" },
      allFilesLoading: true,
    } as never);

    rejectFetch!(new Error("network error"));
    await promise;

    expect(useReviewStore.getState().allFilesLoading).toBe(true);
  });

  it("settles loading when the comparison hasn't changed and the fetch fails", async () => {
    listAllFiles.mockRejectedValue(new Error("network error"));

    await useReviewStore.getState().loadAllFiles();

    expect(useReviewStore.getState().allFilesLoading).toBe(false);
  });
});

describe("loadRepoFiles", () => {
  it("discards a rejection that resolves after the repo changed", async () => {
    let rejectFetch: (err: unknown) => void;
    listRepoFiles.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );

    const promise = useReviewStore.getState().loadRepoFiles();

    // Simulate switching repos while the request is in flight; the new
    // repo's own load claims the loading flag.
    useReviewStore.setState({
      repoPath: "/repo-b",
      allFilesLoading: true,
    } as never);

    rejectFetch!(new Error("network error"));
    await promise;

    expect(useReviewStore.getState().allFilesLoading).toBe(true);
  });

  it("settles loading when the repo hasn't changed and the fetch fails", async () => {
    listRepoFiles.mockRejectedValue(new Error("network error"));

    await useReviewStore.getState().loadRepoFiles();

    expect(useReviewStore.getState().allFilesLoading).toBe(false);
  });
});
