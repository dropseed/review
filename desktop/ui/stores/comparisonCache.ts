import { getApiClient } from "../api";
import type {
  Comparison,
  FileDiff,
  FileEntry,
  GitStatusSummary,
  MovePair,
  ReviewState,
} from "../types";

/**
 * What one comparison leaves behind when it goes off screen, so returning to it
 * paints the diff it was showing instead of a blank stage.
 *
 * Only what a load *computes* is here. Transient flags (loading progress,
 * activities, search) are not: they describe a load in flight, and restoring
 * one would claim a load that isn't happening. Navigation is not either — the
 * navigation snapshot already owns where the user was. Nor is the whole-repo
 * listing (`allFiles`): it is fetched on demand by the surfaces that read it,
 * and holding a second full tree per entry for a tab that may never open is
 * the wrong trade — `ensureAllFiles` refetches it in one call.
 */
export interface ComparisonSnapshot {
  files: FileEntry[];
  filesByPath: Record<string, FileDiff>;
  fileVersions: Record<string, number>;
  movePairs: MovePair[];
  flatFileList: string[];
  classifiedHunkIds: string[] | null;
  reviewState: ReviewState | null;
  carriedForward: number;
  worktreePath: string | null;
  worktreeStale: boolean;
  currentBranch: string | null;
  gitStatus: GitStatusSummary | null;
  stagedFilePaths: Set<string>;
}

/**
 * Everything git can tell us cheaply about the diff a snapshot holds. Two
 * fingerprints taken at different moments being equal is what licenses reusing
 * the snapshot instead of re-diffing.
 *
 * The line counts are the load-bearing part. The two SHAs alone settle a
 * comparison of two commits, but the backend diffs against the working tree
 * whenever `head` is the branch some checkout has out (see `working_tree_dir`
 * in core) — and there neither SHA moves when a file is edited. `--shortstat`
 * is the same `git diff` those endpoints run, reduced to three numbers.
 */
export interface DiffFingerprint {
  baseSha: string;
  headSha: string;
  /** `fileCount additions deletions` from `git diff --shortstat`. */
  stat: string;
}

export interface CacheEntry {
  snapshot: ComparisonSnapshot;
  /**
   * Started when the snapshot is taken, and necessarily then: this is the
   * *before* side of the drift comparison, so it has to describe the diff as
   * it stood when the snapshot was made — probed lazily at restore time it
   * would equal the fresh probe by construction and no drift could ever be
   * seen. Not awaited, so the git calls run alongside the *incoming*
   * comparison's load and the answer is usually ready by the time anyone
   * comes back. `null` means git wouldn't say, which reads as drift.
   */
  fingerprint: Promise<DiffFingerprint | null>;
  /** Taken from the snapshot's own status — no extra call needed. */
  status: string;
}

/**
 * What a restore leaves in the store for `useComparisonLoader` to settle: the
 * consumed entry minus its snapshot (already painted), plus the key it was
 * painted under so a swap that outruns the revalidation can be recognized.
 */
export type RestoredComparison = Omit<CacheEntry, "snapshot"> & {
  key: string;
};

/**
 * Small because each entry holds a whole comparison's hunks. Six is the number
 * of things someone ping-pongs between in a session; beyond that the oldest is
 * cheaper to re-derive than to keep.
 */
const CACHE_LIMIT = 6;

const cache = new Map<string, CacheEntry>();

export function snapshotKey(repoPath: string, comparisonKey: string): string {
  return `${repoPath} ${comparisonKey}`;
}

/** Order-independent digest of what git status says about the working tree. */
export function statusFingerprint(status: GitStatusSummary | null): string {
  if (!status) return "";
  const entries = (list: { path: string; status: string }[]): string =>
    list
      .map((e) => `${e.status}:${e.path}`)
      .sort()
      .join(",");
  return [
    status.currentBranch,
    entries(status.staged),
    entries(status.unstaged),
    [...status.untracked].sort().join(","),
  ].join("|");
}

export function fingerprintsMatch(
  a: DiffFingerprint | null,
  b: DiffFingerprint | null,
): boolean {
  if (!a || !b) return false;
  return (
    a.baseSha === b.baseSha && a.headSha === b.headSha && a.stat === b.stat
  );
}

/** The three git reads the probe is made of. Any failure is drift. */
export async function probeDiff(
  repoPath: string,
  comparison: Comparison,
): Promise<DiffFingerprint | null> {
  const client = getApiClient();
  try {
    const [baseSha, headSha, stat] = await Promise.all([
      client.resolveRef(repoPath, comparison.base),
      client.resolveRef(repoPath, comparison.head),
      client.getDiffShortStat(repoPath, comparison),
    ]);
    return {
      baseSha,
      headSha,
      stat: `${stat.fileCount} ${stat.additions} ${stat.deletions}`,
    };
  } catch {
    return null;
  }
}

export function storeSnapshot(
  repoPath: string,
  comparison: Comparison,
  snapshot: ComparisonSnapshot,
): void {
  const key = snapshotKey(repoPath, comparison.key);
  // Re-insert at the tail so the LRU eviction below drops the least recently
  // written entry rather than the least recently created one.
  cache.delete(key);
  cache.set(key, {
    snapshot,
    fingerprint: probeDiff(repoPath, comparison),
    status: statusFingerprint(snapshot.gitStatus),
  });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Read an entry and drop it in the same breath. A snapshot describes a moment
 * that the restore itself ends — from here on the live store is the record, and
 * leaving again is what writes the next one. Consuming it is also what keeps a
 * comparison that was never left cleanly from being restored from stale data.
 */
export function takeSnapshot(
  repoPath: string,
  comparisonKey: string,
): CacheEntry | null {
  const key = snapshotKey(repoPath, comparisonKey);
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  return entry;
}

/** Drop a repo's entries, or all of them with no argument. */
export function invalidateSnapshots(repoPath?: string): void {
  if (repoPath === undefined) {
    cache.clear();
    return;
  }
  const prefix = `${repoPath} `;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Test seam — the cache is module state, like `attributionCache`. */
export function snapshotKeys(): string[] {
  return [...cache.keys()];
}
