import { useEffect, useState } from "react";
import { useReviewStore } from "../stores";
import { focusWorkspace } from "../commands/workspaceCommands";

/** The query parameter a notification's URL carries — `/?workspace=<id>`. */
const PARAM = "workspace";

/** The workspace a URL names, or null. Relative URLs allowed. */
export function workspaceIdFromUrl(url: string): string | null {
  try {
    return new URL(url, window.location.origin).searchParams.get(PARAM);
  } catch {
    return null;
  }
}

/**
 * The service-worker listener is attached at module scope, not in the hook:
 * the browser flushes a worker's buffered messages at DOMContentLoaded, and
 * the hook mounts later than that — behind `PreferencesGate` at least — so a
 * warm notification tap's message would land on nothing and be gone. Module
 * evaluation happens during the initial script run, before that flush, so a
 * message arriving before the hook mounts waits here instead.
 */
let buffered: string | null = null;
let deliver: ((id: string) => void) | null = null;

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type !== "open-workspace") return;
    const id = workspaceIdFromUrl(data.url ?? "");
    if (!id) return;
    if (deliver) deliver(id);
    else buffered = id;
  });
}

/**
 * Land on the workspace a notification named.
 *
 * Two front doors, one landing. A cold start opens the URL itself, which is the
 * normal case for a push tapped with no window open; a warm one is the service
 * worker focusing the tab it already found and posting the URL in, because
 * navigating that tab would cold-start the app over a session already running.
 *
 * The parameter is stripped the moment it is read, before anything is resolved:
 * the queue may not have loaded yet, and a param still in the bar when it does
 * would re-focus the workspace on every later render — including after the user
 * has deliberately gone somewhere else.
 */
export function useWorkspaceDeepLink(): void {
  const [pending, setPending] = useState<string | null>(() => take());
  const workspaces = useReviewStore((s) => s.workspaces);

  useEffect(() => {
    if (buffered) {
      setPending(buffered);
      buffered = null;
    }
    deliver = setPending;
    return () => {
      if (deliver === setPending) deliver = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const workspace = workspaces.find((entry) => entry.id === pending);
    // Not found yet is not the same as not found: the queue loads after the
    // shell mounts, so an id nothing matches is simply held until it does.
    if (!workspace) return;
    setPending(null);
    focusWorkspace(workspace);
  }, [pending, workspaces]);
}

/** Read the parameter and remove it from the URL in one go. */
function take(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const id = url.searchParams.get(PARAM);
  if (!id) return null;
  url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
  return id;
}
