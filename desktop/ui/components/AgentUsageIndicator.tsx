import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { useAgentUsage } from "../hooks/useAgentUsage";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { ProgressRing } from "./ui/progress-ring";
import { RailSeparator, railTooltipSide, type RailEdge } from "./ui/rail";
import { ClaudeIcon, CodexIcon, RefreshIcon, CheckIcon } from "./ui/icons";
import { useReviewStore } from "../stores";
import { formatSeconds } from "../utils/format-age";
import {
  pacePercent,
  formatPaceDelta,
  formatResetsIn,
} from "../utils/usage-pace";
import type { AgentUsage, UsageWindow } from "../types";

/** Past this age, a snapshot is old enough that the UI should say so. */
const STALE_AFTER_SECONDS = 60 * 60;

/** The fullest of a set of windows — the one that will stop you first. */
function fullest(windows: UsageWindow[]): UsageWindow | undefined {
  return windows.reduce<UsageWindow | undefined>(
    (worst, window) =>
      worst && worst.usedPercent >= window.usedPercent ? worst : window,
    undefined,
  );
}

/**
 * The one number worth a footer's worth of space.
 *
 * This used to be whichever window sat closest to its cap, which silently
 * swapped between the session and the week as they crossed over — so the same
 * bar meant different things at different times of day. The backend now flags
 * the long-horizon window per agent; the session stays a detail for the
 * popover. Where an agent reports several headline caps (Claude splits
 * all-models from per-model), the fullest is the one that binds.
 *
 * `pinnedLabel` is the user's own pick from the popover, which wins when it
 * still matches a window the agent reports — an agent that stops reporting it
 * falls back rather than showing nothing.
 */
function headlineWindow(
  windows: UsageWindow[],
  pinnedLabel?: string,
): UsageWindow | undefined {
  const pinned = windows.find((w) => w.label === pinnedLabel);
  if (pinned) return pinned;
  return fullest(windows.filter((w) => w.headline)) ?? fullest(windows);
}

type UsageTone = "spent" | "warning" | "quiet";

/**
 * Neutral until it's worth noticing. This lives in peripheral vision, so it
 * should stay quiet at the usage levels you spend most of your time at.
 */
function usageTone(percent: number): UsageTone {
  if (percent >= 90) return "spent";
  if (percent >= 70) return "warning";
  return "quiet";
}

const BAR_COLORS: Record<UsageTone, string> = {
  spent: "bg-status-rejected",
  warning: "bg-status-warning",
  quiet: "bg-fg/30",
};

/** The ring's fill reads against a track rather than a panel, so its quiet
 *  level carries more weight than the bar's. */
const RING_COLORS: Record<UsageTone, string> = {
  spent: "stroke-status-rejected",
  warning: "stroke-status-warning",
  quiet: "stroke-fg/45",
};

/**
 * True when every dated window has reset since the snapshot was taken — the
 * percentages describe a period that no longer exists.
 */
function isExpired(agent: AgentUsage, nowSeconds: number): boolean {
  const dated = agent.windows.filter((w) => w.resetsAtUnix !== null);
  return dated.length > 0 && dated.every((w) => w.resetsAtUnix! < nowSeconds);
}

/** The reset instant as the agent stated it — the tooltip behind "in 3h". */
function formatResetAt(window: UsageWindow): string | null {
  if (window.resetsAtText) return window.resetsAtText;
  if (window.resetsAtUnix === null) return null;
  return new Date(window.resetsAtUnix * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Join what's known into one clause-separated line, capitalized.
 *
 * Which clause comes first depends on what the window reports, so none of them
 * can carry its own capital.
 */
function sentence(parts: (string | null)[]): string | null {
  const text = parts.filter((part) => part !== null).join(" · ");
  return text === "" ? null : text.charAt(0).toUpperCase() + text.slice(1);
}

const AGENT_ICONS: Record<
  string,
  (props: { className?: string }) => ReactNode
> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
};

/**
 * The agent's mark, falling back to its name.
 *
 * The backend owns the agent list, so a new agent must stay legible here
 * without a matching frontend change — degrading to the name it already sends
 * beats a row with no identity at all.
 */
function AgentIcon({
  agent,
  className,
}: {
  agent: AgentUsage;
  className?: string;
}): ReactNode {
  const Icon = AGENT_ICONS[agent.id];
  if (Icon) return <Icon className={className} />;
  return (
    <span className={clsx("shrink-0 text-xxs", className)}>{agent.name}</span>
  );
}

/**
 * A usage bar: a track, a fill, and a tick marking where an even burn would
 * have you by now. Shared by the compact row and each window in the popover so
 * the two read as the same measurement at two zoom levels.
 */
function UsageBar({
  percent,
  pace,
  dimmed = false,
}: {
  percent: number;
  pace: number | null;
  dimmed?: boolean;
}): ReactNode {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <span className={clsx("relative h-1 flex-1", dimmed && "opacity-50")}>
      <span className="absolute inset-0 overflow-hidden rounded-full bg-fg/[0.10]">
        <span
          className={clsx(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300",
            BAR_COLORS[usageTone(width)],
          )}
          style={{ width: `${width}%` }}
        />
      </span>
      {/* Where an even burn would have you by now. Sits above the fill so
          it stays legible whichever side of the mark usage is on. */}
      {pace !== null && (
        <span
          aria-hidden="true"
          data-testid="pace-marker"
          className="absolute -top-0.5 -bottom-0.5 w-px bg-fg/50"
          style={{ left: `${pace}%` }}
        />
      )}
    </span>
  );
}

/**
 * Claude and Codex rate-limit usage, one row per agent.
 *
 * The backend returns only agents worth showing, so an API-key user or a
 * machine with neither CLI installed gets an empty list and no widget.
 */
export function AgentUsageIndicator(): ReactNode {
  const { agents, refresh, refreshing } = useAgentUsage();

  if (agents.length === 0) return null;

  return (
    <div className="shrink-0 space-y-0.5 border-t border-t-edge/40 px-3 py-2">
      {agents.map((agent) => (
        <AgentUsageRow
          key={agent.id}
          agent={agent}
          onRefresh={refresh}
          refreshing={refreshing}
        />
      ))}
    </div>
  );
}

interface AgentSnapshot {
  /** The window plotted in the sidebar, or undefined when the agent reports
   *  none — the caller has nothing to draw. */
  headline: UsageWindow | undefined;
  nowSeconds: number;
  expired: boolean;
  /** Expired or stale — either way, "don't read too much into this number". */
  muted: boolean;
  percent: number;
  /** How much of the headline window to draw: the percentage, or nothing at
   *  all once the window it described has reset. */
  filled: number;
  pace: number | null;
  /** Which side of the pace mark usage sits on, in words. */
  paceDelta: string | null;
  pinnedLabel: string | undefined;
}

/**
 * What every presentation of an agent's usage needs: which window it plots,
 * how full it is, and how much of that number to believe. Recomputed per
 * render because half of it is relative to now.
 */
function useAgentSnapshot(agent: AgentUsage): AgentSnapshot {
  const usagePinnedWindows = useReviewStore((s) => s.usagePinnedWindows);
  const pinnedLabel = usagePinnedWindows[agent.id];
  const headline = headlineWindow(agent.windows, pinnedLabel);

  const nowSeconds = Date.now() / 1000;
  const expired = isExpired(agent, nowSeconds);
  const stale =
    agent.observedAtUnix !== null &&
    nowSeconds - agent.observedAtUnix > STALE_AFTER_SECONDS;
  const percent = headline
    ? Math.min(100, Math.max(0, headline.usedPercent))
    : 0;
  const pace = headline && !expired ? pacePercent(headline, nowSeconds) : null;

  return {
    headline,
    nowSeconds,
    expired,
    muted: expired || stale,
    percent,
    filled: expired ? 0 : percent,
    pace,
    paceDelta: pace === null ? null : formatPaceDelta(percent, pace),
    pinnedLabel,
  };
}

/** The trigger's spoken form, shared so the rail's rings say what the rows do. */
/**
 * The row as a sentence — its accessible name, and now its tooltip.
 *
 * Carries the figure the row itself stopped printing, so the exact number is a
 * hover away rather than gone. It also has to carry expiry: a reset window's
 * bar is empty, which is honest about the new window but indistinguishable from
 * a fresh one, and the label used to claim the *old* window's percentage as
 * though it still applied.
 */
function usageLabel(
  agent: AgentUsage,
  headline: UsageWindow,
  percent: number,
  paceDelta: string | null,
  expired: boolean,
): string {
  if (expired) return `${agent.name} usage: ${headline.label} window has reset`;
  return (
    `${agent.name} usage: ${Math.round(percent)}% of ${headline.label}` +
    (paceDelta ? `, ${paceDelta}` : "")
  );
}

function AgentUsageRow({
  agent,
  onRefresh,
  refreshing,
}: {
  agent: AgentUsage;
  onRefresh: () => void;
  refreshing: boolean;
}): ReactNode {
  const snapshot = useAgentSnapshot(agent);
  const [open, setOpen] = useState(false);
  const { headline, expired, muted, percent, filled, pace, paceDelta } =
    snapshot;
  if (!headline) return null;

  const label = usageLabel(agent, headline, percent, paceDelta, expired);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-1 py-0.5
                     hover:bg-fg/[0.06] transition-colors duration-100"
          aria-label={label}
          // The figure the row used to print, on hover and in the popover. Both
          // are a gesture away, which is the right price for a number nobody
          // reads precisely — see below.
          title={label}
        >
          {/* The mark carries the identity here; the name is a click away in
              the popover, and the width it frees goes to the bar. The same
              argument retired the percentage beside it: "61%" is a number you
              read as "over half", which is the one thing a bar says without
              being read at all — and it cost 2rem of a 15rem sidebar, on the
              row least likely to be the reason you looked. The collapsed rail
              has always drawn this as a bare ring with no figure; the two
              agree now. */}
          <AgentIcon
            agent={agent}
            className={clsx(
              "h-3.5 w-3.5 shrink-0",
              muted ? "text-fg-faint/60" : "text-fg-faint",
            )}
          />
          <UsageBar percent={filled} pace={pace} dimmed={muted} />
        </button>
      </PopoverTrigger>

      {/* Only while it's open: the body is a per-window pass over dates and
          pace, and this sits in a sidebar that re-renders on unrelated
          traffic. */}
      {open && (
        <UsageDetails
          agent={agent}
          snapshot={snapshot}
          side="top"
          align="start"
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      )}
    </Popover>
  );
}

/**
 * The window picker behind a usage trigger: every window the agent reports,
 * what each one costs so far, and a way to choose which the sidebar plots.
 *
 * Shared by the rows and the collapsed rail's rings — both are the same
 * measurement at different sizes, so both open the same detail.
 */
function UsageDetails({
  agent,
  snapshot,
  side,
  align,
  onRefresh,
  refreshing,
}: {
  agent: AgentUsage;
  /** The trigger's own reading, handed down rather than recomputed — one
   *  store subscription and one pass over the windows per agent. */
  snapshot: AgentSnapshot;
  side: "top" | "left" | "right";
  align: "start" | "end";
  onRefresh: () => void;
  refreshing: boolean;
}): ReactNode {
  const setUsagePinnedWindow = useReviewStore((s) => s.setUsagePinnedWindow);
  const { headline, nowSeconds, expired, muted, pinnedLabel } = snapshot;
  if (!headline) return null;

  return (
    <PopoverContent side={side} align={align} className="w-64 p-0">
      <div className="flex items-center gap-2 border-b border-edge/40 px-3 py-2">
        <AgentIcon agent={agent} className="h-3.5 w-3.5 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-secondary">
          {agent.name}
        </span>
        {agent.plan && (
          <span className="shrink-0 text-xxs text-fg-faint">{agent.plan}</span>
        )}
        {/* One read covers every agent, so this is deliberately not labelled
              per-agent even though it sits in one agent's popover. */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh usage"
          title="Refresh usage"
          className="shrink-0 rounded p-0.5 text-fg-faint transition-colors
                       hover:bg-fg/[0.06] hover:text-fg-secondary disabled:pointer-events-none"
        >
          <RefreshIcon
            className={clsx("h-3 w-3", refreshing && "animate-spin")}
          />
        </button>
      </div>

      {/* Each window is a choice of what the sidebar bar plots. The default
            is the agent's long-horizon cap, but the session is the number that
            matters when you're deciding whether to start something now. */}
      <div className="py-1">
        {agent.windows.map((window) => {
          const resetsAt = formatResetAt(window);
          const resetsIn = expired ? null : formatResetsIn(window, nowSeconds);
          const windowPace = expired ? null : pacePercent(window, nowSeconds);
          const delta =
            windowPace === null
              ? null
              : formatPaceDelta(window.usedPercent, windowPace);
          const summary = sentence([
            windowPace === null ? null : (delta ?? "on pace"),
            resetsIn
              ? `resets in ${resetsIn}`
              : resetsAt
                ? `resets ${resetsAt}`
                : null,
          ]);
          const isShown = window.label === headline.label;
          return (
            <button
              key={window.label}
              type="button"
              onClick={() =>
                // Clicking the one already shown reverts to the default,
                // so there's a way back without knowing which that was.
                setUsagePinnedWindow(
                  agent.id,
                  pinnedLabel === window.label ? null : window.label,
                )
              }
              aria-pressed={isShown}
              // Without this the name is the whole block of numbers below.
              aria-label={
                isShown
                  ? `${window.label}, shown in the sidebar`
                  : `Show ${window.label} in the sidebar`
              }
              title={
                isShown
                  ? "Shown in the sidebar"
                  : `Show ${window.label} in the sidebar`
              }
              className={clsx(
                "block w-full px-3 py-1.5 text-left transition-colors",
                isShown ? "bg-fg/[0.04]" : "hover:bg-fg/[0.06]",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={clsx(
                    "truncate text-xs",
                    isShown ? "text-fg" : "text-fg-secondary",
                  )}
                >
                  {window.label}
                </span>
                {isShown && (
                  <CheckIcon className="h-2.5 w-2.5 shrink-0 text-fg-faint" />
                )}
                <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-muted">
                  {Math.round(window.usedPercent)}%
                </span>
              </div>
              <div className="mt-1 flex">
                <UsageBar
                  percent={expired ? 0 : window.usedPercent}
                  pace={windowPace}
                  dimmed={muted}
                />
              </div>
              {/* One line for the two things the bar can't say: which side
                    of the tick we're on, and when the window ends. How far
                    into it we are is the tick itself, so it goes unsaid.
                    A duration is what you want at a glance; the wall-clock
                    time stays one hover away for deciding when to come back. */}
              {summary && (
                <div
                  className="mt-1 text-xxs text-fg-faint"
                  title={resetsAt ?? undefined}
                >
                  {summary}
                </div>
              )}
            </button>
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
  );
}

/**
 * One agent's headline window as a ring around its mark, for the collapsed
 * rail — 36px of width has no room for a bar and a number, but a circle round
 * an icon that has to be there anyway costs nothing extra.
 *
 * The pace tick the bar carries is dropped: at this diameter it would read as
 * a nick in the ring rather than a mark against it. It's still one click away
 * in the popover, which is the same one the expanded rows open.
 */
function AgentUsageDial({
  agent,
  onRefresh,
  refreshing,
  edge,
}: {
  agent: AgentUsage;
  onRefresh: () => void;
  refreshing: boolean;
  edge: RailEdge;
}): ReactNode {
  const snapshot = useAgentSnapshot(agent);
  const [open, setOpen] = useState(false);
  const { headline, expired, muted, percent, filled, paceDelta } = snapshot;
  if (!headline) return null;

  const label = usageLabel(agent, headline, percent, paceDelta, expired);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="relative flex h-6 w-6 shrink-0 items-center justify-center
                     rounded-full hover:bg-fg/[0.08]"
        >
          <ProgressRing
            percent={filled}
            size={24}
            strokeWidth={1.5}
            className={clsx("absolute inset-0 h-6 w-6", muted && "opacity-50")}
            arcClassName={RING_COLORS[usageTone(filled)]}
          />
          <AgentIcon
            agent={agent}
            className={clsx(
              "h-3 w-3 shrink-0",
              muted ? "text-fg-faint/60" : "text-fg-faint",
            )}
          />
        </button>
      </PopoverTrigger>

      {open && (
        <UsageDetails
          agent={agent}
          snapshot={snapshot}
          side={railTooltipSide(edge)}
          align="end"
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      )}
    </Popover>
  );
}

/**
 * The usage indicator's collapsed form: a ring per agent, at the foot of the
 * rail where the rows sit when the sidebar is open.
 *
 * Same empty case as the rows — an agent with nothing to report gets no ring,
 * and a machine with no agents gets no separator either.
 */
export function AgentUsageRail({ edge }: { edge: RailEdge }): ReactNode {
  const { agents, refresh, refreshing } = useAgentUsage();

  if (agents.length === 0) return null;

  return (
    <>
      <RailSeparator />
      {agents.map((agent) => (
        <AgentUsageDial
          key={agent.id}
          agent={agent}
          onRefresh={refresh}
          refreshing={refreshing}
          edge={edge}
        />
      ))}
    </>
  );
}
