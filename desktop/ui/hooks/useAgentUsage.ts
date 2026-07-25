import { useEffect, useState } from "react";
import { getApiClient } from "../api";
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

/**
 * Rate-limit usage for the coding agents on this machine, refreshed on a timer
 * while the window is visible.
 */
export function useAgentUsage(): AgentUsage[] {
  const [agents, setAgents] = useState<AgentUsage[]>([]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function refresh(): Promise<void> {
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
        intervalId = setInterval(() => void refresh(), POLL_INTERVAL_MS);
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
        void refresh();
        start();
      } else {
        stop();
      }
    };

    const initialId = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      void refresh();
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

  return agents;
}
