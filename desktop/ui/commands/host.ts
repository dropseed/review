import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { getApiClient } from "../api";
import { nextFontSize } from "./appCommands";
import type { CommandUi, ProvidedCommandUi } from "./types";

/**
 * Imperative UI actions the store cannot own — routing, native window
 * management, and handlers that close over component props.
 *
 * These are contributed by whichever components are mounted, the same way
 * commands themselves are. A command whose action nobody has provided is
 * inert rather than broken: the no-op fallbacks below mean an unmounted
 * provider degrades to "nothing happens" instead of a crash.
 */
const providers: Partial<ProvidedCommandUi>[] = [];

/** Contribute imperative actions for as long as the caller is mounted. */
export function useProvideCommandUi(actions: Partial<ProvidedCommandUi>): void {
  useEffect(() => {
    providers.push(actions);
    return () => {
      const index = providers.indexOf(actions);
      if (index >= 0) providers.splice(index, 1);
    };
  }, [actions]);
}

function resolve<K extends keyof ProvidedCommandUi>(
  key: K,
): ProvidedCommandUi[K] | undefined {
  // Last provider wins, so a review screen can override the shell's default.
  for (let i = providers.length - 1; i >= 0; i--) {
    const action = providers[i][key];
    if (action) return action as ProvidedCommandUi[K];
  }
  return undefined;
}

const noop = () => {};

/**
 * The full `CommandUi`, assembled from store-backed overlay flags, actions
 * that need nothing but the store, and whatever providers are mounted.
 */
export function getCommandUi(): CommandUi {
  const store = () => useReviewStore.getState();

  return {
    openOverlay: (id) => store().openOverlay(id),
    openPalette: (mode) => store().openPalette(mode),
    zoom: (direction) =>
      store().setCodeFontSize(nextFontSize(store().codeFontSize, direction)),
    restartLsp: async () => {
      const { repoPath } = store();
      if (!repoPath) return;
      const api = getApiClient();
      try {
        await api.stopAllLspServers(repoPath);
        const statuses = await api.initLspServers(repoPath);
        store().setLspServerStatuses(statuses);
        console.log("[command] Restarted LSP servers:", statuses);
      } catch (e) {
        console.error("[command] Failed to restart LSP servers:", e);
      }
    },
    openRepo: resolve("openRepo") ?? noop,
    navigate: resolve("navigate") ?? noop,
    activateReviewKey: resolve("activateReviewKey") ?? noop,
    closeTab: resolve("closeTab") ?? noop,
    newTab: resolve("newTab") ?? noop,
    newWindow: resolve("newWindow") ?? noop,
    refresh: resolve("refresh") ?? noop,
  };
}
