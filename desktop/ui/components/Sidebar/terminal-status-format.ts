import type { TerminalPhase, TerminalStatus } from "../../types";

/**
 * Pure formatting helpers for TerminalStatusBadge, split out from the
 * component so they can be unit tested without pulling in the store/api
 * singletons (which have import-time side effects under Vite/Vitest).
 */

/**
 * Tailwind background class for a phase's status dot.
 *
 * `working` wears `phase-working` rather than `status-warning`, which is the
 * same amber the workspace dot uses for "waiting for you". Those two are the
 * pair that most needs telling apart — one says a machine has this, the other
 * says you do — and they were being drawn one line apart in the same #fbbf24.
 * Amber is now spent only on wanting a human.
 */
export function phaseDotClass(phase: TerminalPhase): string {
  switch (phase) {
    case "needs_attention":
      return "bg-status-rejected";
    case "waiting_for_input":
      return "bg-blue";
    case "working":
      return "bg-phase-working";
    case "idle":
      return "bg-fg-faint";
  }
}

/**
 * Tailwind text class for a phase, for markers drawn as a glyph rather than
 * filled shape. Same colours as `phaseDotClass`, on the property a stroked or
 * filled `currentColor` icon inherits.
 */
export function phaseTextClass(phase: TerminalPhase): string {
  switch (phase) {
    case "needs_attention":
      return "text-status-rejected";
    case "waiting_for_input":
      return "text-blue";
    case "working":
      return "text-phase-working";
    case "idle":
      return "text-fg-faint";
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

/**
 * What a set of sessions is asking for, if any is asking in words. A dot only
 * says "attention"; the escape that raised it usually said which one and why,
 * and that is the part worth putting in the tooltip. First one wins — a rail
 * tab stands for a whole tab, and one sentence is all it has room for.
 */
export function attentionText(statuses: TerminalStatus[]): string | null {
  return (
    statuses.find((s) => s.phase === "needs_attention" && s.attentionMessage)
      ?.attentionMessage ?? null
  );
}

/**
 * A phase and what raised it, in one sentence — what every rail and badge puts
 * after the title in its tooltip. Composed here rather than at each call site so
 * the punctuation between the label and the message stays the same everywhere.
 */
export function phaseSummary(
  phase: TerminalPhase,
  statuses: TerminalStatus[],
): string {
  const attention = attentionText(statuses);
  return `${phaseLabel(phase)}${attention ? `: ${attention}` : ""}`;
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
