import { useEffect, useRef } from "react";
import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";
import { useReviewStore } from "../stores";

/**
 * Auto-discovers and starts LSP servers when a repo is loaded.
 * Uses worktree path as workspace root when available (real files on disk).
 * Stops old servers when the root changes to avoid orphaned processes.
 */
export function useLspClient() {
  const repoPath = useReviewStore((s) => s.repoPath);
  const worktreePath = useReviewStore((s) => s.worktreePath);
  const lspDisabledLanguages = useReviewStore((s) => s.lspDisabledLanguages);
  const prevRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (!repoPath || !isTauriEnvironment()) return;

    const api = getApiClient();
    const lspRoot = worktreePath ?? repoPath;
    let cancelled = false;

    // Stop previous servers if root changed, then start new ones
    const prevRoot = prevRootRef.current;
    prevRootRef.current = lspRoot;

    (async () => {
      if (prevRoot && prevRoot !== lspRoot) {
        await api.stopAllLspServers(prevRoot).catch(() => {});
      }
      if (cancelled) return;

      try {
        const statuses = await api.initLspServers(lspRoot);
        if (cancelled) return;
        const disabled = useReviewStore.getState().lspDisabledLanguages;
        const filtered = statuses.filter((s) => !disabled.includes(s.language));
        for (const s of filtered) {
          console.log(`[lsp] ${s.name} (${s.language}): ${s.state}`);
        }
        useReviewStore.getState().setLspServerStatuses(filtered);
      } catch (err: unknown) {
        if (!cancelled) {
          console.error("[lsp] Failed to init LSP servers:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Stop servers on unmount
      api.stopAllLspServers(lspRoot).catch(() => {});
    };
  }, [repoPath, worktreePath, lspDisabledLanguages]);
}
