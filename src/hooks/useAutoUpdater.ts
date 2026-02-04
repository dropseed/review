import { useState, useEffect, useCallback, useRef } from "react";
import { isTauriEnvironment } from "../api/client";
import { getPlatformServices } from "../platform";

interface UpdateInfo {
  version: string;
  downloadAndInstall: () => Promise<void>;
}

interface AutoUpdaterState {
  updateAvailable: UpdateInfo | null;
  installing: boolean;
  checking: boolean;
  error: string | null;
  dismissed: boolean;
}

export function useAutoUpdater() {
  const [state, setState] = useState<AutoUpdaterState>({
    updateAvailable: null,
    installing: false,
    checking: false,
    error: null,
    dismissed: false,
  });

  const checkForUpdate = useCallback(async (options?: { silent?: boolean }) => {
    if (!isTauriEnvironment()) return;

    const silent = options?.silent ?? false;

    if (!silent) {
      setState((s) => ({ ...s, checking: true, error: null }));
    }

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update) {
        setState((s) => ({
          ...s,
          checking: false,
          dismissed: false,
          updateAvailable: {
            version: update.version,
            downloadAndInstall: () => update.downloadAndInstall(),
          },
        }));
        return;
      }

      // No update available
      if (!silent) {
        const platform = getPlatformServices();
        await platform.dialogs.message("You're running the latest version.", {
          title: "No Updates Available",
          kind: "info",
        });
      }
      setState((s) => ({ ...s, checking: false }));
    } catch (err) {
      if (!silent) {
        const message =
          err instanceof Error ? err.message : "Failed to check for updates";
        setState((s) => ({ ...s, checking: false, error: message }));
      }
    }
  }, []);

  // Auto-check on mount (silent)
  useEffect(() => {
    checkForUpdate({ silent: true });
  }, [checkForUpdate]);

  // Listen for menu:check-for-updates event
  const checkForUpdateRef = useRef(checkForUpdate);
  checkForUpdateRef.current = checkForUpdate;

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    const platform = getPlatformServices();
    const unlisten = platform.menuEvents.on("menu:check-for-updates", () => {
      checkForUpdateRef.current({ silent: false });
    });

    return unlisten;
  }, []);

  const installUpdate = useCallback(async () => {
    if (!state.updateAvailable) return;

    setState((s) => ({ ...s, installing: true, error: null }));

    try {
      await state.updateAvailable.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      setState((s) => ({ ...s, installing: false, error: message }));
    }
  }, [state.updateAvailable]);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, dismissed: true }));
  }, []);

  return {
    updateAvailable: state.updateAvailable,
    installing: state.installing,
    checking: state.checking,
    error: state.error,
    dismissed: state.dismissed,
    installUpdate,
    dismiss,
    checkForUpdate,
  };
}
