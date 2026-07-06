import { type ReactNode, useState } from "react";
import { useFindingsPanel } from "../../hooks";
import { CollapsibleSection } from "../ui/collapsible-section";
import { formatAge } from "../../utils/format-age";
import { FilePathLabel } from "./file-path-label";
import { lineRangeRef } from "../../utils/line-range";
import {
  findingStatus,
  type Finding,
  type FindingSeverity,
  type ReviewRun,
} from "../../types";

const FINDINGS_ICON = (
  <svg
    className="h-3.5 w-3.5 text-fg-muted"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>
);

/** Text tone for a severity, keyed on how much it should pull the eye. */
function severityTone(severity: FindingSeverity): string {
  switch (severity) {
    case "high":
      return "bg-status-rejected/15 text-status-rejected";
    case "medium":
      return "bg-status-pending/15 text-status-pending";
    case "low":
      return "bg-status-info/15 text-status-info";
  }
}

/** Left-border accent for an open finding, keyed on severity. */
function severityBorder(severity: FindingSeverity): string {
  switch (severity) {
    case "high":
      return "border-l-status-rejected/40 hover:border-l-status-rejected/80";
    case "medium":
      return "border-l-status-pending/40 hover:border-l-status-pending/80";
    case "low":
      return "border-l-status-info/40 hover:border-l-status-info/80";
  }
}

/** Human label for a resolved finding's disposition — the wire name, spaced. */
function resolutionLabel(resolution: string): string {
  return resolution.replace("-", " ");
}

interface FindingRowProps {
  finding: Finding;
  onGoTo: () => void;
}

function FindingRow({ finding, onGoTo }: FindingRowProps): ReactNode {
  const status = findingStatus(finding);
  const lineRef = lineRangeRef(
    finding.anchor.lineNumber,
    finding.anchor.endLineNumber,
  );
  return (
    <div
      className={`group/f relative rounded-r border-l-2 transition-colors ${
        status.open
          ? severityBorder(finding.severity)
          : "border-l-edge-default opacity-60 hover:opacity-100"
      } hover:bg-surface-hover/60`}
    >
      <button onClick={onGoTo} className="w-full text-left pl-1.5 pr-2 py-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`shrink-0 rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide ${
              status.open
                ? severityTone(finding.severity)
                : "bg-surface-raised/60 text-fg-muted/50"
            }`}
          >
            {finding.severity}
          </span>
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-fg-muted/60">
            {finding.kind}
          </span>
          <span className="min-w-0 flex-1" />
          {lineRef && (
            <span className="shrink-0 rounded bg-surface-raised/60 px-1 py-px text-[9px] tabular-nums text-fg-muted/40">
              {lineRef}
            </span>
          )}
        </div>
        <p
          className={`mt-0.5 line-clamp-2 text-[11px] leading-snug ${
            status.open ? "text-fg-secondary" : "text-fg-muted/70"
          }`}
        >
          {finding.title}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <FilePathLabel
            filePath={finding.anchor.filePath}
            filenameHoverClass="group-hover/f:text-fg"
          />
          {!status.open && status.resolution && (
            <span className="shrink-0 text-[9px] text-fg-muted/50">
              resolved · {resolutionLabel(status.resolution)}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

interface RunLineProps {
  run: ReviewRun;
  findingCount: number;
}

/** The metadata line shared by the latest (expanded) and earlier runs. */
function RunMeta({ run, findingCount }: RunLineProps): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[10px] text-fg-muted/70">
      <span className="font-medium text-fg-secondary">{run.tool}</span>
      {run.model && <span className="text-fg-muted/50">{run.model}</span>}
      <span className="text-fg-muted/40">·</span>
      <span title={run.createdAt}>{formatAge(run.createdAt)}</span>
      <span className="text-fg-muted/40">·</span>
      <span className="tabular-nums">
        {findingCount} finding{findingCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

interface RunsHeaderProps {
  runs: ReviewRun[];
  findingCountByRun: Record<string, number>;
}

/** Compact runs summary: the latest run expanded (with its summary text if
 * present), earlier runs collapsed into a togglable one-liner list. */
function RunsHeader({ runs, findingCountByRun }: RunsHeaderProps): ReactNode {
  const [earlierOpen, setEarlierOpen] = useState(false);
  if (runs.length === 0) return null;

  const [latest, ...earlier] = runs;

  return (
    <div className="mb-1 rounded bg-surface-raised/40 px-2 py-1.5">
      <RunMeta run={latest} findingCount={findingCountByRun[latest.id] ?? 0} />
      {latest.summary && (
        <p className="mt-1 whitespace-pre-wrap text-[10px] leading-snug text-fg-muted/80">
          {latest.summary}
        </p>
      )}

      {earlier.length > 0 && (
        <div className="mt-1">
          <button
            onClick={() => setEarlierOpen((v) => !v)}
            className="flex items-center gap-1 text-left hover:opacity-80"
          >
            <svg
              className={`h-2.5 w-2.5 text-fg-muted/50 transition-transform ${
                earlierOpen ? "rotate-90" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span className="text-[9px] font-medium text-fg-muted/70">
              {earlier.length} earlier run{earlier.length === 1 ? "" : "s"}
            </span>
          </button>
          {earlierOpen && (
            <div className="mt-0.5 flex flex-col gap-0.5 pl-3.5">
              {earlier.map((run) => (
                <RunMeta
                  key={run.id}
                  run={run}
                  findingCount={findingCountByRun[run.id] ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Top-level "Findings" panel section: the review runs that produced them and
 * the findings themselves, open ones up front and resolved ones tucked into a
 * collapsed subsection. Read-only — clicking a finding navigates to its file.
 * Renders nothing when there are no runs and no findings.
 */
export function ReviewFindingsPanel(): ReactNode {
  const { runs, openFindings, resolvedFindings, findingCountByRun, goToFile } =
    useFindingsPanel();

  const [isOpen, setIsOpen] = useState(true);
  const [resolvedOpen, setResolvedOpen] = useState(false);

  // Empty: no runs and no findings → render no panel chrome at all.
  if (
    runs.length === 0 &&
    openFindings.length === 0 &&
    resolvedFindings.length === 0
  ) {
    return null;
  }

  return (
    <CollapsibleSection
      title="Findings"
      icon={FINDINGS_ICON}
      badge={openFindings.length || undefined}
      badgeColor="bg-status-rejected/20 text-status-rejected"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
    >
      <div className="flex flex-col gap-px px-2 pb-2">
        <RunsHeader runs={runs} findingCountByRun={findingCountByRun} />

        {openFindings.length > 0 && (
          <div className="max-h-64 overflow-y-auto scrollbar-thin flex flex-col gap-px">
            {openFindings.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                onGoTo={() => goToFile(f.anchor.filePath)}
              />
            ))}
          </div>
        )}

        {openFindings.length === 0 && resolvedFindings.length > 0 && (
          <div className="px-1 py-2 text-center">
            <p className="text-[10px] text-fg-muted/60">No open findings</p>
          </div>
        )}

        {resolvedFindings.length > 0 && (
          <div className="flex flex-col">
            <button
              onClick={() => setResolvedOpen((v) => !v)}
              className="flex items-center gap-1.5 px-1 pb-0.5 pt-1 text-left hover:opacity-80"
            >
              <svg
                className={`h-2.5 w-2.5 text-fg-muted/50 transition-transform ${
                  resolvedOpen ? "rotate-90" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="text-[10px] font-medium text-fg-muted/70">
                Resolved
              </span>
              <span className="text-[9px] tabular-nums text-fg-muted/40">
                {resolvedFindings.length}
              </span>
            </button>
            {resolvedOpen && (
              <div className="max-h-48 overflow-y-auto scrollbar-thin flex flex-col gap-px">
                {resolvedFindings.map((f) => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    onGoTo={() => goToFile(f.anchor.filePath)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
