import { useEffect, useRef } from "react";
import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";
import { useSpurStore } from "../stores";
import { useDebounce } from "./useDebounce";
import type { LspServerStatus } from "../types";

/**
 * A review's worktree path is resolved from its review state, a moment after
 * its repo path lands in the store. Letting the root settle first keeps that
 * intermediate value from starting an indexer for a workspace we're about to
 * navigate off of.
 */
const ROOT_SETTLE_MS = 250;

/** Publish the servers the user hasn't turned off. */
function publishStatuses(discovered: LspServerStatus[], disabled: string[]) {
  useSpurStore
    .getState()
    .setLspServerStatuses(
      discovered.filter((s) => !disabled.includes(s.language)),
    );
}

/**
 * Auto-discovers and starts LSP servers when a repo is loaded.
 * Uses worktree path as workspace root when available (real files on disk).
 *
 * Servers are deliberately left running when the root changes: switching
 * reviews used to stop them, which made rust-analyzer re-index from scratch
 * every time the user came back. The backend keeps the most recently used
 * roots warm and shuts the rest down (`MAX_WARM_LSP_ROOTS`).
 */
/**
 * One init per root at a time. StrictMode mounts every effect twice in dev,
 * and each init is a real IPC call that can spawn a language server — the
 * backend now survives the race, but there is no reason to run it. The entry
 * clears on settle so a later revisit re-inits (the backend may have evicted
 * the root by then).
 */
const initsInFlight = new Map<string, Promise<LspServerStatus[]>>();

function initOncePerRoot(root: string): Promise<LspServerStatus[]> {
  const existing = initsInFlight.get(root);
  if (existing) return existing;
  const promise = getApiClient()
    .initLspServers(root)
    .finally(() => initsInFlight.delete(root));
  initsInFlight.set(root, promise);
  return promise;
}

export function useLspClient() {
  const lspRoot = useDebounce(
    useSpurStore((s) => s.worktreePath ?? s.repoPath),
    ROOT_SETTLE_MS,
  );
  const lspDisabledLanguages = useSpurStore((s) => s.lspDisabledLanguages);

  // What the backend last reported for this root, unfiltered — so toggling a
  // language in settings re-filters what we already know instead of paying
  // another discovery pass.
  const discoveredRef = useRef<LspServerStatus[]>([]);

  useEffect(() => {
    if (!lspRoot || !isTauriEnvironment()) return;

    let cancelled = false;
    initOncePerRoot(lspRoot)
      .then((statuses) => {
        if (cancelled) return;
        discoveredRef.current = statuses;
        for (const s of statuses) {
          console.log(`[lsp] ${s.name} (${s.language}): ${s.state}`);
        }
        publishStatuses(statuses, useSpurStore.getState().lspDisabledLanguages);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("[lsp] Failed to init LSP servers:", err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lspRoot]);

  useEffect(() => {
    if (discoveredRef.current.length > 0) {
      publishStatuses(discoveredRef.current, lspDisabledLanguages);
    }
  }, [lspDisabledLanguages]);
}
