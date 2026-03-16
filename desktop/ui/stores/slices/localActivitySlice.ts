import type { DiffShortStat, RepoLocalActivity } from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClientAndStorage } from "../types";
import type { StorageService } from "../../platform";
import { resolveNewRepoMetadata } from "../../utils/resolve-repo-metadata";

/** Default collapsed state for repos in the All view. */
export const LOCAL_REPO_DEFAULT_COLLAPSED = true;

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
  /** Per-repo collapsed state in the Local section */
  localRepoCollapsed: Record<string, boolean>;
  /** Whether the Local section shows only branches with working tree changes or all branches */
  localViewMode: "changes" | "all";
  /** "repoPath:branch" -> stats hash when the user last viewed this branch */
  lastSeenDiffStats: Record<string, string>;

  loadLocalActivity: () => Promise<void>;
  markDiffSeen: (
    repoPath: string,
    branch: string,
    stats: DiffShortStat | null,
  ) => void;
  unregisterRepo: (repoPath: string) => Promise<void>;
  toggleLocalRepoCollapsed: (repoPath: string) => void;
  setLocalViewMode: (mode: "changes" | "all") => void;
}

export const createLocalActivitySlice: SliceCreatorWithClientAndStorage<
  LocalActivitySlice
> = (client: ApiClient, storage: StorageService) => (set, get) => {
  let seenStatsLoaded = false;

  return {
    localActivity: [],
    localActivityLoading: false,
    localRepoCollapsed: {},
    localViewMode: "changes",
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

    toggleLocalRepoCollapsed: (repoPath) => {
      const current =
        get().localRepoCollapsed[repoPath] ?? LOCAL_REPO_DEFAULT_COLLAPSED;
      set({
        localRepoCollapsed: {
          ...get().localRepoCollapsed,
          [repoPath]: !current,
        },
      });
    },

    setLocalViewMode: (mode) => {
      set({ localViewMode: mode });
    },
  };
};
