import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useConnectionStore } from "../stores/connection";
import { ApiClient } from "./client";
import type { Comparison, DiffHunk, DiffShortStat, GlobalReviewSummary, ReviewState } from "./types";

function useApiClient(): ApiClient | null {
  const { serverUrl, authToken, isConnected } = useConnectionStore();
  if (!isConnected || !serverUrl || !authToken) return null;
  return new ApiClient(serverUrl, authToken);
}

export function useServerInfo() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["serverInfo"],
    queryFn: () => client!.getInfo(),
    enabled: !!client,
    staleTime: 60_000,
  });
}

export function useReviewsGlobal() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["reviewsGlobal"],
    queryFn: () => client!.getReviewsGlobal(),
    enabled: !!client,
    refetchInterval: 30_000,
  });
}

export function useFiles(repoPath: string | undefined, comparison: Comparison | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["files", repoPath, comparison?.key],
    queryFn: () => client!.getFiles(repoPath!, comparison!),
    enabled: !!client && !!repoPath && !!comparison,
  });
}

export function useAllHunks(
  repoPath: string | undefined,
  comparison: Comparison | undefined,
  filePaths: string[] | undefined
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["allHunks", repoPath, comparison?.key],
    queryFn: () => client!.getAllHunks(repoPath!, comparison!, filePaths!),
    enabled: !!client && !!repoPath && !!comparison && !!filePaths && filePaths.length > 0,
  });
}

export function useFile(
  repoPath: string | undefined,
  filePath: string | undefined,
  comparison: Comparison | undefined
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["file", repoPath, filePath, comparison?.key],
    queryFn: () => client!.getFile(repoPath!, filePath!, comparison!),
    enabled: !!client && !!repoPath && !!filePath && !!comparison,
  });
}

export function useReviewState(
  repoPath: string | undefined,
  comparison: Comparison | undefined
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["reviewState", repoPath, comparison?.key],
    queryFn: () => client!.getState(repoPath!, comparison!),
    enabled: !!client && !!repoPath && !!comparison,
  });
}

/** Resolve avatar URLs for each unique repo by fetching remote info. */
export function useRepoAvatars(reviews: GlobalReviewSummary[] | undefined) {
  const client = useApiClient();

  const repoPaths = [
    ...new Set((reviews ?? []).map((r) => r.repoPath)),
  ];

  return useQuery({
    queryKey: ["repoAvatars", repoPaths],
    queryFn: async () => {
      if (!client || !reviews) return {};
      const results: Record<string, string | null> = {};
      await Promise.all(
        repoPaths.map(async (repoPath) => {
          try {
            const info = await client.getRemoteInfo(repoPath);
            if (info.browseUrl) {
              const url = new URL(info.browseUrl);
              const org = url.pathname.split("/")[1];
              if (org) {
                results[repoPath] = `${url.origin}/${org}.png?size=64`;
                return;
              }
            }
          } catch {
            // Skip
          }
          results[repoPath] = null;
        })
      );
      return results;
    },
    enabled: !!client && !!reviews && reviews.length > 0,
    staleTime: 300_000,
  });
}

export function useSaveReviewState() {
  const { serverUrl, authToken } = useConnectionStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      repoPath,
      state,
    }: {
      repoPath: string;
      state: ReviewState;
    }) => {
      const client = new ApiClient(serverUrl, authToken);
      await client.saveState(repoPath, state);
    },
    onMutate: async ({ repoPath, state }) => {
      const queryKey = ["reviewState", repoPath, state.comparison.key];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ReviewState>(queryKey);
      queryClient.setQueryData(queryKey, state);
      return { previous, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
    onSettled: (_data, _err, { repoPath, state }) => {
      queryClient.invalidateQueries({
        queryKey: ["reviewState", repoPath, state.comparison.key],
      });
      queryClient.invalidateQueries({ queryKey: ["reviewsGlobal"] });
    },
  });
}

function isDiffActive(stat: DiffShortStat): boolean {
  return stat.fileCount > 0 || stat.additions > 0 || stat.deletions > 0;
}

export interface ReviewDiffInfo {
  isActive: boolean;
  stats: DiffShortStat | null;
}

/** Fetch diff stats for each review and return a map of review key → diff info. */
export function useReviewDiffStats(reviews: GlobalReviewSummary[] | undefined) {
  const client = useApiClient();

  const keys = (reviews ?? []).map(
    (r) => `${r.repoPath}:${r.comparison.key}`
  );

  return useQuery({
    queryKey: ["reviewDiffStats", keys],
    queryFn: async () => {
      if (!client || !reviews) return {};
      const results: Record<string, ReviewDiffInfo> = {};
      await Promise.all(
        reviews.map(async (review) => {
          const key = `${review.repoPath}:${review.comparison.key}`;
          try {
            const stats = await client.getDiffShortStat(
              review.repoPath,
              review.comparison
            );
            results[key] = { isActive: isDiffActive(stats), stats };
          } catch {
            // Default to active if we can't fetch stats
            results[key] = { isActive: true, stats: null };
          }
        })
      );
      return results;
    },
    enabled: !!client && !!reviews && reviews.length > 0,
    staleTime: 60_000,
  });
}

export function useTaxonomy(repoPath: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["taxonomy", repoPath],
    queryFn: () => client!.getTaxonomy(repoPath!),
    enabled: !!client && !!repoPath,
    staleTime: 300_000,
  });
}
