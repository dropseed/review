import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useConnectionStore } from "../stores/connection";
import { ApiClient } from "./client";
import type { Comparison, DiffHunk, ReviewState } from "./types";

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

export function useTaxonomy(repoPath: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["taxonomy", repoPath],
    queryFn: () => client!.getTaxonomy(repoPath!),
    enabled: !!client && !!repoPath,
    staleTime: 300_000,
  });
}
