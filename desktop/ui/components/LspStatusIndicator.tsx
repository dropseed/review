import { type ReactNode, useState } from "react";
import { useReviewStore } from "../stores";
import { getApiClient } from "../api";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { SimpleTooltip } from "./ui/tooltip";
import type { LspServerStatus } from "../types";

function stateColor(state: LspServerStatus["state"]): string {
  switch (state) {
    case "ready":
      return "bg-status-approved";
    case "starting":
      return "bg-status-warning";
    case "error":
      return "bg-status-rejected";
    case "stopped":
      return "bg-fg-faint";
  }
}

function stateLabel(state: LspServerStatus["state"]): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "starting":
      return "Starting";
    case "error":
      return "Error";
    case "stopped":
      return "Stopped";
  }
}

function aggregateColor(statuses: LspServerStatus[]): string {
  if (statuses.some((s) => s.state === "error")) return "bg-status-rejected";
  if (statuses.some((s) => s.state === "starting")) return "bg-status-warning";
  if (statuses.every((s) => s.state === "ready")) return "bg-status-approved";
  return "bg-fg-faint";
}

export function LspStatusIndicator(): ReactNode {
  const statuses = useReviewStore((s) => s.lspServerStatuses);
  const setLspServerStatuses = useReviewStore((s) => s.setLspServerStatuses);
  const repoPath = useReviewStore((s) => s.repoPath);
  const [restarting, setRestarting] = useState<string | null>(null);

  if (statuses.length === 0) return null;

  async function handleRestart(language: string) {
    if (!repoPath) return;
    setRestarting(language);
    try {
      const updated = await getApiClient().restartLspServer(repoPath, language);
      setLspServerStatuses(
        statuses.map((s) => (s.language === language ? updated : s)),
      );
    } catch (err) {
      console.error(`[lsp] Failed to restart ${language}:`, err);
      setLspServerStatuses(
        statuses.map((s) =>
          s.language === language ? { ...s, state: "error" as const } : s,
        ),
      );
    } finally {
      setRestarting(null);
    }
  }

  const tooltipText = statuses
    .map((s) => `${s.name} (${s.language}): ${stateLabel(s.state)}`)
    .join(", ");

  return (
    <Popover>
      <SimpleTooltip content={tooltipText} side="top">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="p-1.5 rounded text-fg-faint hover:text-fg-muted hover:bg-fg/[0.06]
                       transition-colors duration-100 flex items-center gap-1"
            aria-label="LSP server status"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${aggregateColor(statuses)}`}
            />
            <span className="text-xxs">LSP</span>
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent side="top" align="start" className="w-64 p-0">
        <div className="px-3 py-2 border-b border-edge/40">
          <span className="text-xs font-medium text-fg-secondary">
            Language Servers
          </span>
        </div>
        <div className="py-1">
          {statuses.map((s) => (
            <div
              key={s.language}
              className="flex items-center justify-between px-3 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${stateColor(s.state)}`}
                />
                <span className="text-xs text-fg-secondary truncate">
                  {s.name}
                </span>
                <span className="text-xxs text-fg-faint">{s.language}</span>
              </div>
              <button
                type="button"
                onClick={() => handleRestart(s.language)}
                disabled={restarting === s.language}
                className="shrink-0 ml-2 rounded px-1.5 py-0.5 text-xxs text-fg-muted
                           hover:text-fg-secondary hover:bg-surface-raised transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {restarting === s.language ? "..." : "Restart"}
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
