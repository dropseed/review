import { useCallback, useSyncExternalStore } from "react";
import { getApiClient } from "../api";
import { useAsyncAction } from "./useAsyncAction";
import type { AgentUsage } from "../types";

/**
 * How often the agents are re-consulted. Reading Claude's usage spawns a CLI
 * subprocess costing a second or two of CPU, and the numbers behind it move on
 * a 5-hour and 7-day cadence — polling faster buys nothing.
 */
const POLL_INTERVAL_MS = 5 * 60_000;

/**
 * Delay before the first read, so the subprocess doesn't compete with repo
 * resolution, the initial diff, and LSP startup. Nothing is visible before
 * then anyway.
 */
const INITIAL_DELAY_MS = 5_000;

export interface AgentUsageState {
  agents: AgentUsage[];
  /** Re-read every agent now, ignoring the service-side cache. */
  refresh: () => void;
  /** True while a manual refresh is in flight, so the button can say so. */
  refreshing: boolean;
}

/**
 * One poll for the whole app.
 *
 * The sidebar shows usage in two places — rows when it's open, rings on the
 * rail when it's collapsed — and a read costs a CLI subprocess, so the timer
 * belongs to the module rather than to whichever components happen to be
 * mounted. Sharing the last snapshot also means a component that mounts later
 * has something to draw immediately instead of a blank until the next poll.
 */
let snapshot: AgentUsage[] = [];
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let initialId: ReturnType<typeof setTimeout> | null = null;

function publish(agents: AgentUsage[]): void {
  snapshot = agents;
  for (const listener of listeners) listener();
}

async function poll(): Promise<void> {
  try {
    publish(await getApiClient().getAgentUsage(false));
  } catch (err) {
    // Usage is ambient chrome. A failed read leaves the last known values
    // in place rather than surfacing an error the user can't act on.
    console.debug("[usage] failed to read agent usage:", err);
  }
}

function startPolling(): void {
  if (intervalId === null) {
    intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }
}

function stopPolling(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function handleVisibility(): void {
  if (document.visibilityState === "visible") {
    void poll();
    startPolling();
  } else {
    stopPolling();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    initialId = setTimeout(handleVisibility, INITIAL_DELAY_MS);
    document.addEventListener("visibilitychange", handleVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (initialId !== null) clearTimeout(initialId);
      initialId = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      stopPolling();
    }
  };
}

/**
 * Rate-limit usage for the coding agents on this machine, refreshed on a timer
 * while the window is visible, and on demand.
 *
 * The timer is deliberately slow, which leaves one case it serves badly: a
 * window that has just reset, where the displayed number is known to be wrong
 * and waiting minutes for the next poll is the wrong answer. `refresh` is that
 * escape hatch.
 */
export function useAgentUsage(): AgentUsageState {
  const agents = useSyncExternalStore(subscribe, () => snapshot);

  // Not routed through `poll`, which swallows failures to keep the ambient
  // timer quiet: a refresh is something the user asked for, so its error has
  // to reach useAsyncAction.
  const [runRefresh, refreshing] = useAsyncAction(
    useCallback(async () => {
      publish(await getApiClient().getAgentUsage(true));
    }, []),
    "refresh agent usage",
  );

  return { agents, refresh: () => void runRefresh(), refreshing };
}
