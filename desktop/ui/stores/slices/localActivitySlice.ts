import type { DiffShortStat, RepoLocalActivity } from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClientAndStorage } from "../types";
import type { StorageService } from "../../platform";
import { resolveNewRepoMetadata } from "../../utils/resolve-repo-metadata";

/** Build a composite key for a branch within a repo. */
export function makeBranchKey(repoPath: string, branch: string): string {
  return `${repoPath}:${branch}`;
}

/** Hash diff stats into a comparable string. */
export function statsHash(stats: DiffShortStat | null | undefined): string {
  if (!stats) return "none";
  return `${stats.fileCount}:${stats.additions}:${stats.deletions}`;
}

export interface LocalActivitySlice {
  localActivity: RepoLocalActivity[];
  localActivityLoading: boolean;
  /** "repoPath:branch" -> stats hash when the user last viewed this branch */
  lastSeenDiffStats: Record<string, string>;

  loadLocalActivity: () => Promise<void>;
  /** Apply a scoped activity delta for one repo (upserts by repoPath). */
  applyRepoActivityDelta: (activity: RepoLocalActivity) => void;
  markDiffSeen: (
    repoPath: string,
    branch: string,
    stats: DiffShortStat | null,
  ) => void;
  unregisterRepo: (repoPath: string) => Promise<void>;
}

export const createLocalActivitySlice: SliceCreatorWithClientAndStorage<
  LocalActivitySlice
> = (client: ApiClient, storage: StorageService) => (set, get) => {
  let seenStatsLoaded = false;

  return {
    localActivity: [],
    localActivityLoading: false,
    lastSeenDiffStats: {},

    loadLocalActivity: async () => {
      // Hydrate persisted lastSeenDiffStats from storage once
      if (!seenStatsLoaded) {
        seenStatsLoaded = true;
        try {
          const persisted =
            await storage.get<Record<string, string>>("lastSeenDiffStats");
          if (persisted) {
            set({ lastSeenDiffStats: persisted });
          }
        } catch {
          // Ignore storage errors
        }
      }

      set({ localActivityLoading: true });
      try {
        const activity = await client.listAllLocalActivity();

        // Skip state update if the activity data hasn't changed (avoids
        // unnecessary re-renders of sidebar components on no-op refreshes).
        const prev = get().localActivity;
        if (
          prev.length === activity.length &&
          JSON.stringify(prev) === JSON.stringify(activity)
        ) {
          set({ localActivityLoading: false });
          return;
        }

        // Prune lastSeenDiffStats to only branches that still exist in any repo
        const validKeys = new Set<string>();
        for (const repo of activity) {
          for (const branch of repo.branches) {
            validKeys.add(makeBranchKey(repo.repoPath, branch.name));
          }
        }
        const current = get().lastSeenDiffStats;
        const pruned: Record<string, string> = {};
        for (const [key, value] of Object.entries(current)) {
          if (validKeys.has(key)) pruned[key] = value;
        }

        set({
          localActivity: activity,
          localActivityLoading: false,
          lastSeenDiffStats: pruned,
        });

        // Resolve metadata (avatar, route prefix) for repos not yet in repoMetadata
        const repoPaths = activity.map((r) => r.repoPath);
        const newMetadata = await resolveNewRepoMetadata(
          repoPaths,
          get().repoMetadata,
          client,
        );
        set({ repoMetadata: newMetadata });
      } catch (err) {
        console.error("Failed to load local activity:", err);
        set({ localActivityLoading: false });
      }
    },

    applyRepoActivityDelta: (activity) => {
      const current = get().localActivity;
      const idx = current.findIndex((r) => r.repoPath === activity.repoPath);
      if (idx !== -1 && current[idx] === activity) return;

      const next =
        idx === -1
          ? [...current, activity]
          : current.map((r, i) => (i === idx ? activity : r));

      // Prune lastSeenDiffStats entries for branches that no longer exist
      // in this repo. Only touch keys scoped to the delta's repoPath.
      const prevStats = get().lastSeenDiffStats;
      const stillExists = new Set<string>(
        activity.branches.map((b) => makeBranchKey(activity.repoPath, b.name)),
      );
      let stats = prevStats;
      const scopePrefix = `${activity.repoPath}:`;
      for (const key of Object.keys(prevStats)) {
        if (key.startsWith(scopePrefix) && !stillExists.has(key)) {
          if (stats === prevStats) stats = { ...prevStats };
          delete stats[key];
        }
      }

      set({ localActivity: next, lastSeenDiffStats: stats });
    },

    markDiffSeen: (repoPath, branch, stats) => {
      const key = makeBranchKey(repoPath, branch);
      const updated = {
        ...get().lastSeenDiffStats,
        [key]: statsHash(stats),
      };
      set({ lastSeenDiffStats: updated });
      storage.set("lastSeenDiffStats", updated).catch(() => {});
    },

    unregisterRepo: async (repoPath) => {
      await client.unregisterRepo(repoPath);
      get().loadLocalActivity();
    },
  };
};
