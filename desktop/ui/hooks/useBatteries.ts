import { useSyncExternalStore } from "react";
import { getApiClient } from "../api";
import type { Battery } from "../types";

/**
 * How often the machine is re-consulted.
 *
 * A percentage moves about half a point a minute, and both reads are cheap
 * subprocesses, so this is paced by what is worth redrawing rather than by what
 * it costs. The service caches for a third of this, which is what keeps several
 * attached clients from each spawning their own pair.
 */
const POLL_INTERVAL_MS = 60_000;

/**
 * One poll for the whole app, shared through `useSyncExternalStore`.
 *
 * The same module-level shape `useAgentUsage` uses, and for the same reason: a
 * timer that belongs to whichever component happened to mount stops when that
 * component unmounts, and the last snapshot is worth keeping so a remount draws
 * a number immediately instead of a blank until the next tick.
 */
let snapshot: Battery[] = [];
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Replaced wholesale only when the list actually differs.
 *
 * `useSyncExternalStore` compares snapshots by identity, so handing it a fresh
 * array every minute would re-render every reader on every poll — and a poll
 * that says 62% for the twentieth time is not news.
 */
function publish(batteries: Battery[]): void {
  if (sameBatteries(snapshot, batteries)) return;
  snapshot = batteries;
  for (const listener of listeners) listener();
}

function sameBatteries(a: Battery[], b: Battery[]): boolean {
  return (
    a.length === b.length &&
    a.every((battery, i) => {
      const other = b[i];
      return (
        battery.id === other.id &&
        battery.percent === other.percent &&
        battery.state === other.state &&
        battery.minutesRemaining === other.minutesRemaining
      );
    })
  );
}

async function poll(): Promise<void> {
  try {
    publish(await getApiClient().getBatteries());
  } catch (err) {
    // Ambient chrome. A failed read leaves the last known charge on screen
    // rather than raising an error nobody can act on from a phone.
    console.debug("[power] failed to read batteries:", err);
  }
}

function handleVisibility(): void {
  if (document.visibilityState === "visible") {
    void poll();
    if (intervalId === null) {
      intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
    }
  } else if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = null;
    }
  };
}

/**
 * The batteries on the machine serving this app, refreshed while the window is
 * visible.
 *
 * Empty is the ordinary answer on most machines — a desktop Mac with no
 * accessories, or a host that is not a Mac — and means "show nothing", never
 * "still loading". A backgrounded phone stops polling and shows whatever it
 * last saw until it is looked at again, which is a minute stale at worst and
 * the same thing every OS battery readout does.
 */
export function useBatteries(): Battery[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}
