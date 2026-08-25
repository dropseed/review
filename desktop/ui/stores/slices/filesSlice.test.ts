import { vi, describe, it, expect, beforeEach } from "vitest";
import type { FileEntry } from "../../types";
import { makeComparison } from "../../types";
import type { Viewpoint } from "../../types/viewpoint";
import { REVIEW_VIEWPOINT } from "../../types/viewpoint";

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

describe("setViewpoint", () => {
  const range = (base: string, head: string, ordinal: number): Viewpoint => ({
    kind: "range",
    range: {
      kind: "commits" as const,
      loOrdinal: ordinal,
      hiOrdinal: ordinal,
      title: `#${ordinal}`,
      comparison: makeComparison(base, head),
    },
  });
  const peek = (hash: string, base: string): Viewpoint => ({
    kind: "commit",
    view: {
      hash,
      shortHash: hash.slice(0, 7),
      subject: "a commit",
      comparison: makeComparison(base, hash),
      isMerge: false,
    },
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
      viewpoint: REVIEW_VIEWPOINT,
      reviewState: { hunks: {} },
      attribution,
      attributionLoaded: true,
      files: [{ name: "a.ts", path: "a.ts", isDirectory: false }],
    } as never);
  };

  it("swaps in the range as the comparison but keeps the review's identity", () => {
    seed();
    useReviewStore.getState().setViewpoint(range("main", "sha1", 1));

    const s = useReviewStore.getState();
    expect(s.comparison?.key).toBe("main..sha1");
    expect(s.reviewComparison).toEqual(reviewComparison);
    expect(s.reviewRef).toBe("feature");
    expect(s.baseReason).toBe("branchVsDefault");
    // Stale diff data is cleared so the range re-diffs from scratch.
    expect(s.files).toEqual([]);
  });

  it("keeps the review attached while narrowed — a range is still the review", () => {
    seed();
    useReviewStore.getState().setViewpoint(range("main", "sha1", 1));

    // The no-persistence gate is the peek's alone: decisions made inside a
    // range are the review's and still save.
    expect(useReviewStore.getState().reviewState).not.toBeNull();
  });

  it("keeps commit attribution, which describes the branch and not the range", () => {
    seed();
    useReviewStore.getState().setViewpoint(range("sha1", "sha2", 2));

    // Dropping this would leave the picker offering only the commit already
    // selected, with no way back to the full list.
    const s = useReviewStore.getState();
    expect(s.attribution).toBe(attribution);
    expect(s.attributionLoaded).toBe(true);
  });

  it("restores the review comparison when the range is cleared", () => {
    seed();
    useReviewStore.getState().setViewpoint(range("main", "sha1", 1));
    useReviewStore.getState().setViewpoint(REVIEW_VIEWPOINT);

    const s = useReviewStore.getState();
    expect(s.comparison).toEqual(reviewComparison);
    expect(s.viewpoint).toEqual(REVIEW_VIEWPOINT);
  });

  it("ignores a viewpoint that names what is already on screen", () => {
    seed();
    useReviewStore.getState().setViewpoint(range("main", "sha1", 1));
    useReviewStore.setState({
      files: [{ name: "b.ts", path: "b.ts", isDirectory: false }],
    } as never);
    useReviewStore.getState().setViewpoint(range("main", "sha1", 1));

    // A no-op, not a re-diff: the same range re-selected must not throw away
    // the diff already on screen.
    expect(useReviewStore.getState().files).toHaveLength(1);
  });

  it("nulls the review state for a peek, which is what stops it persisting", () => {
    seed();
    useReviewStore.getState().setViewpoint(peek("abc1234", "abc1234^"));

    const s = useReviewStore.getState();
    expect(s.comparison?.key).toBe("abc1234^..abc1234");
    expect(s.reviewState).toBeNull();
    // The review's identity is untouched, so leaving restores it intact.
    expect(s.reviewComparison).toEqual(reviewComparison);
    expect(s.reviewRef).toBe("feature");
  });

  it("leaves a peek back onto the review, with its state to be reloaded", () => {
    seed();
    useReviewStore.getState().setViewpoint(peek("abc1234", "abc1234^"));
    useReviewStore.getState().setViewpoint(REVIEW_VIEWPOINT);

    const s = useReviewStore.getState();
    expect(s.comparison).toEqual(reviewComparison);
    expect(s.viewpoint).toEqual(REVIEW_VIEWPOINT);
    // Still null on the way out — the loader refills it from disk against the
    // comparison it lands on.
    expect(s.reviewState).toBeNull();
  });

  it("does nothing without a review comparison to express it against", () => {
    seed();
    useReviewStore.setState({ reviewComparison: null } as never);
    useReviewStore.getState().setViewpoint(range("main", "sha1", 1));

    const s = useReviewStore.getState();
    expect(s.viewpoint).toEqual(REVIEW_VIEWPOINT);
    expect(s.comparison).toEqual(reviewComparison);
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

describe("ensureAllFiles / refreshAllFiles", () => {
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

    const promise = useReviewStore.getState().refreshAllFiles();

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

    await useReviewStore.getState().ensureAllFiles();

    expect(useReviewStore.getState().allFilesLoading).toBe(false);
  });

  it("refreshes only a listing something already asked for", async () => {
    useReviewStore.setState({ allFiles: [] } as never);
    await useReviewStore.getState().refreshAllFiles();
    expect(listAllFiles).not.toHaveBeenCalled();

    useReviewStore.setState({ allFiles: baseTree } as never);
    listAllFiles.mockResolvedValue(baseTree);
    await useReviewStore.getState().refreshAllFiles();
    expect(listAllFiles).toHaveBeenCalledTimes(1);
  });
});

describe("ensureAllFiles", () => {
  const comparison = { base: "main", head: "a", key: "main..a" };

  beforeEach(() => {
    useReviewStore.setState({
      comparison,
      allFiles: [],
      allFilesLoading: false,
    } as never);
  });

  it("fetches once and coalesces concurrent callers", async () => {
    listAllFiles.mockResolvedValue(baseTree);

    const { ensureAllFiles } = useReviewStore.getState();
    await Promise.all([ensureAllFiles(), ensureAllFiles(), ensureAllFiles()]);

    expect(listAllFiles).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState().allFiles).toEqual(baseTree);
  });

  it("does nothing once the listing is loaded", async () => {
    useReviewStore.setState({ allFiles: baseTree } as never);

    await useReviewStore.getState().ensureAllFiles();

    expect(listAllFiles).not.toHaveBeenCalled();
  });

  it("retries after a failure", async () => {
    listAllFiles.mockRejectedValueOnce(new Error("network error"));
    await useReviewStore.getState().ensureAllFiles();
    expect(useReviewStore.getState().allFiles).toEqual([]);

    listAllFiles.mockResolvedValue(baseTree);
    await useReviewStore.getState().ensureAllFiles();
    expect(useReviewStore.getState().allFiles).toEqual(baseTree);
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
