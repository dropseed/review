import { useCallback, useEffect, useState } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
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
 * `useRepoActivitySync`: `work.json` is global and the `review` CLI edits it
 * with or without a repo open, so the list has to stay live on the home screen
 * too.
 *
 * The focus refresh lives here rather than inside a transport so both clients
 * behave the same — `TauriClient` had none — and so it is visibility-gated like
 * every other poll in the app.
 *
 * It also owns the terminal-attachment migration, because this is the one place
 * that knows both halves have arrived: an attachment only means something
 * against the item list, and migrating before the list loads would drop every
 * stored attachment as unclaimed. Re-running costs nothing — the migration writes
 * only when it changes something, and a value it wrote survives itself.
 *
 * "Arrived" means a load that *succeeded*, not one that finished: a failed read
 * leaves the list empty, and an empty list is indistinguishable from an empty
 * queue to the migration, which would then unclaim every attachment the user
 * has — and persist that. So every refresh here reports its outcome, and the
 * first success is what arms the migration.
 */
export function useWorkSync() {
  const loadWorkItems = useReviewStore((s) => s.loadWorkItems);
  const workItems = useReviewStore((s) => s.workItems);
  const migrateTerminalAttachments = useReviewStore(
    (s) => s.migrateTerminalAttachments,
  );
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void loadWorkItems().then((ok) => {
      if (ok) setLoaded(true);
    });
  }, [loadWorkItems]);

  useEffect(() => {
    refresh();
    const apiClient = getApiClient();
    return apiClient.onWorkChanged(refresh);
  }, [refresh]);

  // The item list is the migration's whole input — it reads the stored
  // attachments itself. Subscribing to those too re-ran the full migration on
  // every attach, detach, split and pane move, to discover each time that
  // nothing changed.
  useEffect(() => {
    if (!loaded) return;
    migrateTerminalAttachments(workItems);
  }, [loaded, workItems, migrateTerminalAttachments]);

  usePollWhileVisible(refresh, POLL_INTERVAL_MS, { onFocus: true });
}
