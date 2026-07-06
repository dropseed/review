import { useMemo } from "react";
import { useReviewStore } from "../stores";
import { findingStatus, type Finding, type ReviewRun } from "../types";

export interface FindingsPanelState {
  /** Review passes recorded against this comparison, newest first. */
  runs: ReviewRun[];
  /** Open findings — the queue that still needs attention. */
  openFindings: Finding[];
  /** Resolved findings, kept reachable but visually subdued. */
  resolvedFindings: Finding[];
  /** How many findings each run raised, keyed by run id. */
  findingCountByRun: Record<string, number>;
  goToFile: (filePath: string) => void;
}

/** High → low, so the most severe open findings sort to the top. */
const SEVERITY_RANK: Record<Finding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Sort by severity, then file path, then line, then creation time. */
function bySeverityThenLocation(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.anchor.filePath.localeCompare(b.anchor.filePath) ||
    (a.anchor.lineNumber ?? 0) - (b.anchor.lineNumber ?? 0) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

/**
 * Self-contained hook for the read-only findings panel. Reads runs and findings
 * straight off the loaded review state (the same object the file watcher
 * refreshes), so CLI-written findings appear live without a reopen.
 */
export function useFindingsPanel(): FindingsPanelState {
  const reviewState = useReviewStore((s) => s.reviewState);
  const revealFileInTree = useReviewStore((s) => s.revealFileInTree);

  const runs = useMemo(() => {
    // Newest run first — the latest pass is the one worth expanding.
    return [...(reviewState?.runs ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [reviewState?.runs]);

  const findingCountByRun = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of reviewState?.findings ?? []) {
      if (f.runId) counts[f.runId] = (counts[f.runId] ?? 0) + 1;
    }
    return counts;
  }, [reviewState?.findings]);

  const { openFindings, resolvedFindings } = useMemo(() => {
    const open: Finding[] = [];
    const resolved: Finding[] = [];
    for (const f of reviewState?.findings ?? []) {
      (findingStatus(f).open ? open : resolved).push(f);
    }
    open.sort(bySeverityThenLocation);
    resolved.sort(bySeverityThenLocation);
    return { openFindings: open, resolvedFindings: resolved };
  }, [reviewState?.findings]);

  return {
    runs,
    openFindings,
    resolvedFindings,
    findingCountByRun,
    goToFile: revealFileInTree,
  };
}
