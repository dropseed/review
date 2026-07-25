import { type ReactNode } from "react";
import clsx from "clsx";
import { useAgentUsage } from "../hooks/useAgentUsage";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { formatSeconds } from "../utils/format-age";
import type { AgentUsage, UsageWindow } from "../types";

/** Past this age, a snapshot is old enough that the UI should say so. */
const STALE_AFTER_SECONDS = 60 * 60;

/**
 * The window closest to its cap — that's the one that will actually stop you,
 * and the only number worth a footer's worth of space.
 */
function headlineWindow(windows: UsageWindow[]): UsageWindow | undefined {
  return windows.reduce<UsageWindow | undefined>(
    (worst, window) =>
      worst && worst.usedPercent >= window.usedPercent ? worst : window,
    undefined,
  );
}

/**
 * Neutral until it's worth noticing. This lives in peripheral vision, so it
 * should stay quiet at the usage levels you spend most of your time at.
 */
function barColor(percent: number): string {
  if (percent >= 90) return "bg-status-rejected";
  if (percent >= 70) return "bg-status-warning";
  return "bg-fg/30";
}

/**
 * True when every dated window has reset since the snapshot was taken — the
 * percentages describe a period that no longer exists.
 */
function isExpired(agent: AgentUsage, nowSeconds: number): boolean {
  const dated = agent.windows.filter((w) => w.resetsAtUnix !== null);
  return dated.length > 0 && dated.every((w) => w.resetsAtUnix! < nowSeconds);
}

function formatReset(window: UsageWindow): string | null {
  if (window.resetsAtText) return window.resetsAtText;
  if (window.resetsAtUnix === null) return null;
  return new Date(window.resetsAtUnix * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Claude and Codex rate-limit usage, one row per agent.
 *
 * The backend returns only agents worth showing, so an API-key user or a
 * machine with neither CLI installed gets an empty list and no widget.
 */
export function AgentUsageIndicator(): ReactNode {
  const agents = useAgentUsage();

  if (agents.length === 0) return null;

  return (
    <div className="shrink-0 space-y-0.5 border-t border-t-edge/40 px-3 py-2">
      {agents.map((agent) => (
        <AgentUsageRow key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function AgentUsageRow({ agent }: { agent: AgentUsage }): ReactNode {
  const headline = headlineWindow(agent.windows);
  if (!headline) return null;

  const nowSeconds = Date.now() / 1000;
  const expired = isExpired(agent, nowSeconds);
  const stale =
    agent.observedAtUnix !== null &&
    nowSeconds - agent.observedAtUnix > STALE_AFTER_SECONDS;
  const percent = Math.min(100, Math.max(0, headline.usedPercent));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-1 py-0.5
                     hover:bg-fg/[0.06] transition-colors duration-100"
          aria-label={`${agent.name} usage: ${Math.round(percent)}% of ${headline.label}`}
        >
          <span className="w-11 shrink-0 truncate text-left text-xxs text-fg-faint">
            {agent.name}
          </span>
          <span
            className={clsx(
              "relative h-1 flex-1 overflow-hidden rounded-full bg-fg/[0.10]",
              (expired || stale) && "opacity-50",
            )}
          >
            <span
              className={clsx(
                "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300",
                barColor(percent),
              )}
              style={{ width: `${expired ? 0 : percent}%` }}
            />
          </span>
          <span
            className={clsx(
              "w-7 shrink-0 text-right text-xxs tabular-nums",
              expired || stale ? "text-fg-faint" : "text-fg-muted",
            )}
          >
            {expired ? "—" : `${Math.round(percent)}%`}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent side="top" align="start" className="w-64 p-0">
        <div className="flex items-center justify-between border-b border-edge/40 px-3 py-2">
          <span className="text-xs font-medium text-fg-secondary">
            {agent.name}
          </span>
          {agent.plan && (
            <span className="text-xxs text-fg-faint">{agent.plan}</span>
          )}
        </div>

        <div className="py-1">
          {agent.windows.map((window) => {
            const resets = formatReset(window);
            return (
              <div key={window.label} className="px-3 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-fg-secondary">
                    {window.label}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                    {Math.round(window.usedPercent)}%
                  </span>
                </div>
                {resets && (
                  <div className="mt-0.5 text-xxs text-fg-faint">
                    Resets {resets}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {agent.observedAtUnix !== null && (
          <div className="border-t border-edge/40 px-3 py-2 text-xxs text-fg-faint">
            {expired
              ? `These windows have reset since the snapshot. Run ${agent.name} to refresh.`
              : `Snapshot from ${formatSeconds(nowSeconds - agent.observedAtUnix)} ago — ${agent.name} reports usage only while it runs.`}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
