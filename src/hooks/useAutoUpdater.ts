import { useState, useEffect, useCallback } from "react";
import { isTauriEnvironment } from "../api/client";

interface UpdateInfo {
  version: string;
  downloadAndInstall: () => Promise<void>;
}

interface AutoUpdaterState {
  updateAvailable: UpdateInfo | null;
  installing: boolean;
  error: string | null;
  dismissed: boolean;
}

export function useAutoUpdater() {
  const [state, setState] = useState<AutoUpdaterState>({
    updateAvailable: null,
    installing: false,
    error: null,
    dismissed: false,
  });

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let cancelled = false;

    async function checkForUpdate() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled) return;

        if (update) {
          setState((s) => ({
            ...s,
            updateAvailable: {
              version: update.version,
              downloadAndInstall: () => update.downloadAndInstall(),
            },
          }));
        }
      } catch {
        // Non-critical — silently ignore check failures
      }
    }

    checkForUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  const installUpdate = useCallback(async () => {
    if (!state.updateAvailable) return;

    setState((s) => ({ ...s, installing: true, error: null }));

    try {
      await state.updateAvailable.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setState((s) => ({
        ...s,
        installing: false,
        error: err instanceof Error ? err.message : "Update failed",
      }));
    }
  }, [state.updateAvailable]);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, dismissed: true }));
  }, []);

  return {
    updateAvailable: state.updateAvailable,
    installing: state.installing,
    error: state.error,
    dismissed: state.dismissed,
    installUpdate,
    dismiss,
  };
}
