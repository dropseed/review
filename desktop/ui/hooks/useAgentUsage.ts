import { useCallback, useEffect, useState } from "react";
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
 * Rate-limit usage for the coding agents on this machine, refreshed on a timer
 * while the window is visible, and on demand.
 *
 * The timer is deliberately slow, which leaves one case it serves badly: a
 * window that has just reset, where the displayed number is known to be wrong
 * and waiting minutes for the next poll is the wrong answer. `refresh` is that
 * escape hatch.
 */
export function useAgentUsage(): AgentUsageState {
  const [agents, setAgents] = useState<AgentUsage[]>([]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll(): Promise<void> {
      try {
        const next = await getApiClient().getAgentUsage();
        if (!cancelled) setAgents(next);
      } catch (err) {
        // Usage is ambient chrome. A failed read leaves the last known values
        // in place rather than surfacing an error the user can't act on.
        console.debug("[usage] failed to read agent usage:", err);
      }
    }

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
      }
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
        start();
      } else {
        stop();
      }
    };

    const initialId = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      void poll();
      start();
    }, INITIAL_DELAY_MS);

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearTimeout(initialId);
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, []);

  const [runRefresh, refreshing] = useAsyncAction(
    useCallback(async () => {
      setAgents(await getApiClient().getAgentUsage(true));
    }, []),
    "refresh agent usage",
  );

  return { agents, refresh: () => void runRefresh(), refreshing };
}
