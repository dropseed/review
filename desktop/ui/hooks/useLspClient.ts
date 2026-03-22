import { useEffect } from "react";
import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";
import { useReviewStore } from "../stores";

/**
 * Auto-discovers and starts LSP servers when a repo is loaded.
 * Servers are shared across tabs (managed by the backend) and cleaned up on app exit.
 * Respects lspDisabledLanguages preference to skip disabled servers.
 */
export function useLspClient() {
  const repoPath = useReviewStore((s) => s.repoPath);
  const lspDisabledLanguages = useReviewStore((s) => s.lspDisabledLanguages);

  useEffect(() => {
    if (!repoPath || !isTauriEnvironment()) return;

    const api = getApiClient();

    api
      .initLspServers(repoPath)
      .then((statuses) => {
        const disabled = useReviewStore.getState().lspDisabledLanguages;
        const filtered = statuses.filter((s) => !disabled.includes(s.language));
        for (const s of filtered) {
          console.log(`[lsp] ${s.name} (${s.language}): ${s.state}`);
        }
        useReviewStore.getState().setLspServerStatuses(filtered);
      })
      .catch((err: unknown) => {
        console.error("[lsp] Failed to init LSP servers:", err);
      });

    // No cleanup: servers are shared app-level state (multiple tabs may use
    // the same server). They are cleaned up on process exit via kill_on_drop.
  }, [repoPath, lspDisabledLanguages]);
}
