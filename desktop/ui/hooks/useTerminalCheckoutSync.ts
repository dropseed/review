import { useEffect } from "react";
import { useReviewStore } from "../stores";

/**
 * Republish the checkout layout whenever the listings change.
 *
 * These are the only things that say a worktree appeared or vanished, so this
 * is also when a terminal whose row is gone gets rescued to one that exists.
 *
 * Mounted at the AppShell level, like `useRepoActivitySync`: the sidebar draws
 * its terminal badges on every route, and they read this index — so a repo not
 * being open is not a reason for it to be empty.
 */
export function useTerminalCheckoutSync() {
  const localActivity = useReviewStore((s) => s.localActivity);
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const setTerminalCheckouts = useReviewStore((s) => s.setTerminalCheckouts);

  useEffect(() => {
    setTerminalCheckouts(localActivity, globalReviews);
  }, [localActivity, globalReviews, setTerminalCheckouts]);
}
