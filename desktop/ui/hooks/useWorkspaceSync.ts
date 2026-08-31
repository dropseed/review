import { useCallback, useEffect } from "react";
import { getApiClient } from "../api";
import { useSpurStore } from "../stores";
import { usePollWhileVisible } from "./usePollWhileVisible";

/**
 * A slow backstop under the `work-changed` event, mostly there for the focus
 * refresh. The desktop app's watcher is reliable, but in web mode the SSE
 * stream only exists while a repo watcher is running — so with no repo open,
 * which is exactly the home screen where the queue is shown, nothing arrives.
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * App-wide listener for `work-changed`. Mounted at the AppShell level, like
 * `useRepoActivitySync`: `workspaces.json` is global and the `spur` CLI edits it
 * with or without a repo open, so the list has to stay live on the home screen
 * too.
 *
 * The focus refresh lives here rather than inside a transport so both clients
 * behave the same — `TauriClient` had none — and so it is visibility-gated like
 * every other poll in the app.
 *
 */
export function useWorkspaceSync() {
  const loadWorkspaces = useSpurStore((s) => s.loadWorkspaces);

  const refresh = useCallback(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    refresh();
    const apiClient = getApiClient();
    return apiClient.onWorkChanged(refresh);
  }, [refresh]);

  usePollWhileVisible(refresh, POLL_INTERVAL_MS, { onFocus: true });
}
