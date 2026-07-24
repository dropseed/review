import type { TerminalPhase } from "../../types";

/**
 * Pure formatting helpers for TerminalStatusBadge, split out from the
 * component so they can be unit tested without pulling in the store/api
 * singletons (which have import-time side effects under Vite/Vitest).
 */

/** Tailwind background class for a phase's status dot. */
export function phaseDotClass(phase: TerminalPhase): string {
  switch (phase) {
    case "needs_attention":
      return "bg-status-rejected";
    case "waiting_for_input":
      return "bg-blue";
    case "working":
      return "bg-status-warning";
    case "idle":
      return "bg-fg-faint";
  }
}

/** Humanized label for a phase. */
export function phaseLabel(phase: TerminalPhase): string {
  switch (phase) {
    case "needs_attention":
      return "Needs attention";
    case "waiting_for_input":
      return "Waiting for input";
    case "working":
      return "Working";
    case "idle":
      return "Idle";
  }
}

/** Format a duration in milliseconds as a compact string: 45s, 3m, 2h 5m. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

/** Basename of a filesystem path (for cwd labels). */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed;
}
