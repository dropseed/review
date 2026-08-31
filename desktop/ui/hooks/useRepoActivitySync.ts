import { useEffect } from "react";
import { getApiClient } from "../api";
import { useSpurStore } from "../stores";

/**
 * App-wide listener for `repo-activity-changed` events. Mounted at the
 * AppShell level so sidebar deltas apply during startup and on the home
 * screen — not just while a repo is open in ReviewView.
 */
export function useRepoActivitySync() {
  const applyRepoActivityDelta = useSpurStore((s) => s.applyRepoActivityDelta);

  useEffect(() => {
    const apiClient = getApiClient();
    const unlisten = apiClient.onRepoActivityChanged((payload) => {
      applyRepoActivityDelta(payload.activity);
    });
    return unlisten;
  }, [applyRepoActivityDelta]);
}
