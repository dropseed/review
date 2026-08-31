import { vi, describe, it, expect, beforeEach } from "vitest";
import { makeComparison } from "../types";
import type {
  Comparison,
  FileEntry,
  GitStatusSummary,
  ResolvedReview,
  ReviewState,
} from "../types";

const {
  listFiles,
  listAllFiles,
  listRepoFiles,
  listDirectoryContents,
  resolveRef,
  getDiffShortStat,
  getGitStatus,
  loadReviewState,
  listAllReviewsGlobal,
} = vi.hoisted(() => ({
  listFiles: vi.fn(),
  listAllFiles: vi.fn(),
  listRepoFiles: vi.fn(),
  listDirectoryContents: vi.fn(),
  resolveRef: vi.fn(),
  getDiffShortStat: vi.fn(),
  getGitStatus: vi.fn(),
  loadReviewState: vi.fn(),
  listAllReviewsGlobal: vi.fn(),
}));

// Same stubbing as filesSlice.test.ts: the store wires a real backend client at
// module load. These tests drive store logic plus the probe's git reads.
vi.mock("../api", () => ({
  getApiClient: () =>
    new Proxy(
      {
        listFiles,
        listAllFiles,
        listRepoFiles,
        listDirectoryContents,
        resolveRef,
        getDiffShortStat,
        getGitStatus,
        loadReviewState,
        listAllReviewsGlobal,
      },
      { get: (target, prop) => target[prop as never] ?? (() => () => {}) },
    ),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useSpurStore } from "./index";
import {
  invalidateSnapshots,
  snapshotKeys,
  statusFingerprint,
  fingerprintsMatch,
} from "./comparisonCache";
import { hasDrifted } from "../hooks/useComparisonLoader";

const REPO_A = "/repo-a";
const REPO_B = "/repo-b";

const featureA = makeComparison("main", "feature-a");
const featureB = makeComparison("main", "feature-b");

const resolved = (comparison: Comparison, ref: string): ResolvedReview => ({
  ref,
  comparison,
  baseReason: "branchVsDefault",
});

const reviewState = (ref: string): ReviewState => ({
  ref,
  hunks: {},
  trustList: [],
  notes: "",
  annotations: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
  totalDiffHunks: 1,
});

const tree: FileEntry[] = [
  { name: "a.ts", path: "a.ts", isDirectory: false, status: "modified" },
];

const status = (branch: string): GitStatusSummary => ({
  currentBranch: branch,
  staged: [],
  unstaged: [{ path: "a.ts", status: "modified" }],
  untracked: [],
  indexLocked: false,
});

/** A settled review, exactly as the pipeline leaves it. */
function seedLoaded(repoPath: string, comparison: Comparison, ref: string) {
  useSpurStore.setState({
    repoPath,
    comparison,
    reviewComparison: comparison,
    reviewRef: ref,
    reviewBaseOverride: null,
    baseReason: "branchVsDefault",
    viewpoint: { kind: "review" },
    isStandaloneFile: false,
    loadingProgress: null,
    files: tree,
    flatFileList: ["a.ts"],
    filesByPath: { "a.ts": { hunks: [], contentHash: "h1" } },
    allFiles: tree,
    movePairs: [],
    fileVersions: {},
    classifiedHunkIds: ["a.ts:h1"],
    reviewState: reviewState(ref),
    carriedForward: 3,
    currentBranch: ref,
    gitStatus: status(ref),
    stagedFilePaths: new Set<string>(),
    loadedGitIgnoredDirs: new Set<string>(),
    worktreePath: null,
    worktreeStale: false,
  } as never);
}

beforeEach(() => {
  invalidateSnapshots();
  for (const fn of [
    listFiles,
    listAllFiles,
    listRepoFiles,
    listDirectoryContents,
    resolveRef,
    getDiffShortStat,
    getGitStatus,
    loadReviewState,
    listAllReviewsGlobal,
  ]) {
    fn.mockReset();
  }
  loadReviewState.mockResolvedValue(reviewState("feature-a"));
  listAllReviewsGlobal.mockResolvedValue([]);
  listFiles.mockResolvedValue([]);
  listAllFiles.mockResolvedValue([]);
  resolveRef.mockResolvedValue("sha");
  getDiffShortStat.mockResolvedValue({
    fileCount: 1,
    additions: 2,
    deletions: 3,
  });
  getGitStatus.mockResolvedValue(status("feature-a"));
});

describe("snapshot on leave", () => {
  it("captures the comparison-scoped state a load computes", async () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));

    expect(snapshotKeys()).toEqual([`${REPO_A} ${featureA.key}`]);
  });

  it("does not capture a commit-range narrowing", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore.setState({
      viewpoint: {
        kind: "range",
        range: {
          kind: "commits",
          loOrdinal: 1,
          hiOrdinal: 1,
          title: "#1",
          comparison: featureA,
        },
      },
    } as never);

    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));

    expect(snapshotKeys()).toEqual([]);
  });

  it("does not capture a commit peek", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore.getState().setViewpoint({
      kind: "commit",
      view: {
        hash: "abc123",
        shortHash: "abc123",
        subject: "a commit",
        comparison: featureA,
        isMerge: false,
      },
    });

    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));

    expect(snapshotKeys()).toEqual([]);
  });

  it("does not capture a standalone file", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore.setState({ isStandaloneFile: true } as never);

    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));

    expect(snapshotKeys()).toEqual([]);
  });

  it("does not capture a load still in flight", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore.setState({
      loadingProgress: { current: 0, total: 1, phase: "files" },
    } as never);

    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));

    expect(snapshotKeys()).toEqual([]);
  });
});

describe("restore on return", () => {
  it("paints the cached diff instead of the reset state", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));
    expect(useSpurStore.getState().flatFileList).toEqual([]);

    useSpurStore
      .getState()
      .switchReview(REPO_A, resolved(featureA, "feature-a"));

    const s = useSpurStore.getState();
    expect(s.flatFileList).toEqual(["a.ts"]);
    expect(s.files).toEqual(tree);
    expect(s.filesByPath["a.ts"].contentHash).toBe("h1");
    expect(s.classifiedHunkIds).toEqual(["a.ts:h1"]);
    expect(s.reviewState?.ref).toBe("feature-a");
    expect(s.carriedForward).toBe(3);
    expect(s.gitStatus?.currentBranch).toBe("feature-a");
    expect(s.currentBranch).toBe("feature-a");
    // No load is in flight, so nothing draws the first-visit skeleton.
    expect(s.loadingProgress).toBeNull();
    expect(s.restoredComparison?.key).toBe(featureA.key);
  });

  it("takes the identity from the review being switched to, not the cache", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));
    useSpurStore.getState().switchReview(REPO_A, {
      ref: "feature-a",
      baseOverride: "origin/main",
      comparison: featureA,
      baseReason: "override",
    });

    const s = useSpurStore.getState();
    expect(s.reviewBaseOverride).toBe("origin/main");
    expect(s.baseReason).toBe("override");
  });

  it("is consumed by the restore, and written again on the next leave", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));
    useSpurStore
      .getState()
      .switchReview(REPO_A, resolved(featureA, "feature-a"));
    expect(snapshotKeys()).toEqual([]);

    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));
    expect(snapshotKeys()).toEqual([`${REPO_A} ${featureA.key}`]);
  });

  it("leaves a first visit on the reset state", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));

    const s = useSpurStore.getState();
    expect(s.restoredComparison).toBeNull();
    expect(s.loadingProgress).toEqual({
      current: 0,
      total: 0,
      phase: "pending",
    });
  });
});

describe("invalidation", () => {
  it("drops a repo's entries by prefix", () => {
    seedLoaded(REPO_A, featureA, "feature-a");
    useSpurStore
      .getState()
      .switchReview(REPO_B, resolved(featureB, "feature-b"));
    seedLoaded(REPO_B, featureB, "feature-b");
    useSpurStore
      .getState()
      .switchReview(REPO_A, resolved(featureA, "feature-a"));

    expect(snapshotKeys()).toContain(`${REPO_B} ${featureB.key}`);
    invalidateSnapshots(REPO_B);
    expect(snapshotKeys()).toEqual([]);
  });
});

describe("statusFingerprint", () => {
  it("is order-independent but path- and status-sensitive", () => {
    const a: GitStatusSummary = {
      currentBranch: "main",
      staged: [],
      unstaged: [
        { path: "b.ts", status: "modified" },
        { path: "a.ts", status: "added" },
      ],
      untracked: ["z.ts"],
      indexLocked: false,
    };
    const reordered: GitStatusSummary = {
      ...a,
      unstaged: [...a.unstaged].reverse(),
    };
    expect(statusFingerprint(a)).toBe(statusFingerprint(reordered));
    expect(statusFingerprint(a)).not.toBe(
      statusFingerprint({
        ...a,
        unstaged: [
          { path: "b.ts", status: "modified" },
          { path: "a.ts", status: "modified" },
        ],
      }),
    );
    expect(statusFingerprint(a)).not.toBe(
      statusFingerprint({ ...a, untracked: [] }),
    );
  });
});

describe("fingerprintsMatch", () => {
  const fp = { baseSha: "b", headSha: "h", stat: "1 2 3" };

  it("treats an unanswered probe as a mismatch", () => {
    expect(fingerprintsMatch(null, fp)).toBe(false);
    expect(fingerprintsMatch(fp, null)).toBe(false);
  });

  it("compares both refs and the line counts", () => {
    expect(fingerprintsMatch(fp, { ...fp })).toBe(true);
    expect(fingerprintsMatch(fp, { ...fp, headSha: "h2" })).toBe(false);
    expect(fingerprintsMatch(fp, { ...fp, baseSha: "b2" })).toBe(false);
    expect(fingerprintsMatch(fp, { ...fp, stat: "1 2 4" })).toBe(false);
  });
});

describe("hasDrifted", () => {
  const restored = (over?: Partial<{ stat: string; status: string }>) => ({
    key: featureA.key,
    fingerprint: Promise.resolve({
      baseSha: "sha",
      headSha: "sha",
      stat: over?.stat ?? "1 2 3",
    }),
    status: over?.status ?? statusFingerprint(status("feature-a")),
  });

  beforeEach(() => {
    seedLoaded(REPO_A, featureA, "feature-a");
  });

  it("is false when both refs, the line counts and the status agree", async () => {
    await expect(hasDrifted(restored())).resolves.toBe(false);
  });

  it("is true when head moved", async () => {
    resolveRef.mockImplementation(async (_repo: string, ref: string) =>
      ref === "feature-a" ? "moved" : "sha",
    );
    await expect(hasDrifted(restored())).resolves.toBe(true);
  });

  it("is true when the diff's line counts changed but no ref moved", async () => {
    getDiffShortStat.mockResolvedValue({
      fileCount: 1,
      additions: 9,
      deletions: 3,
    });
    await expect(hasDrifted(restored())).resolves.toBe(true);
  });

  it("is true when the working tree's status changed", async () => {
    getGitStatus.mockResolvedValue({
      currentBranch: "feature-a",
      staged: [],
      unstaged: [],
      untracked: ["new.ts"],
      indexLocked: false,
    });
    await expect(hasDrifted(restored())).resolves.toBe(true);
  });

  it("is true when git would not answer", async () => {
    resolveRef.mockRejectedValue(new Error("no such ref"));
    await expect(hasDrifted(restored())).resolves.toBe(true);
  });
});
