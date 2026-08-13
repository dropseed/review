import { type ReactNode, useMemo } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { useWorkItems } from "../../stores/selectors/work";
import {
  usePhasesByItemId,
  useTabGlance,
  useUnattachedTabIds,
} from "../../stores/selectors/terminals";
import { activateWorkItem } from "../../commands/workCommands";
import { makeReviewKey } from "../../utils/review-key";
import { Rail, RailButton, RailSeparator, railTooltipSide } from "../ui/rail";
import { SidebarPanelIcon } from "../ui/icons";
import { SimpleTooltip, RICH_TOOLTIP_CLASS } from "../ui/tooltip";
import { AgentUsageRail } from "../AgentUsageIndicator";
import { jumpToTab } from "../Terminal/jump";
import { TerminalGlanceCard } from "../Terminal/TerminalGlanceCard";
import { PhaseDot } from "./PhaseDot";
import { phaseTextClass } from "./terminal-status-format";
import { useWorkContext } from "./work-context";
import { describeWorkItem, type WorkContext } from "./work-status";
import type { TerminalPhase, WorkItem } from "../../types";

/**
 * The sidebar's collapsed state — the same rule the terminal panel follows:
 * hiding a pane leaves a strip on its edge, not nothing. Collapsing used to
 * drop the sidebar to zero width and float a lone toggle over the content,
 * which read as a stray button in dead space.
 *
 * What it carries is what survives losing the labels: the work items, as the
 * numbers they already answer to (⌘1–9 and the number on each card), and below
 * them every terminal tab no item has claimed. Between the two, nothing that
 * is running is more than one click away — which is what collapsed has to keep
 * being, or it is just a button that undoes itself.
 */
export function SidebarRail({ onExpand }: { onExpand: () => void }): ReactNode {
  const items = useWorkItems();
  const unattached = useUnattachedTabIds();
  const ctx = useWorkContext();
  const phasesByItem = usePhasesByItemId();

  return (
    <Rail className="w-9 shrink-0 border-r border-edge bg-surface">
      <RailButton label="Show sidebar (⌘B)" edge="left" onClick={onExpand}>
        <SidebarPanelIcon className="h-3.5 w-3.5" />
      </RailButton>

      {items.length > 0 && <RailSeparator />}

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
        {items.map((item, index) => (
          <WorkRailTab
            key={item.id}
            item={item}
            index={index}
            ctx={ctx}
            phase={phasesByItem[item.id] ?? null}
          />
        ))}

        {items.length > 0 && unattached.length > 0 && (
          <RailSeparator className="my-0.5" />
        )}

        {unattached.map((tabId) => (
          <TerminalRailDot key={tabId} tabId={tabId} />
        ))}
      </div>

      {/* Where the usage rows sit when the sidebar is open — kept at the foot
          rather than dropped, since how much of the week is left is exactly
          the kind of thing you want without expanding anything. */}
      <AgentUsageRail edge="left" />
    </Rail>
  );
}

/**
 * One work item, as its position number.
 *
 * The number is the item's whole identity here, and it is the same number the
 * card shows and ⌘N presses — a rotated title would be a second name for a
 * thing that already has a short one. Colour is the loudest phase among the
 * item's own terminals, so the strip still says which of them wants a human.
 */
function WorkRailTab({
  item,
  index,
  ctx,
  phase,
}: {
  item: WorkItem;
  index: number;
  ctx: WorkContext;
  phase: TerminalPhase | null;
}): ReactNode {
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);

  const status = useMemo(() => describeWorkItem(item, ctx), [item, ctx]);

  const activeKey = activeReviewKey
    ? makeReviewKey(activeReviewKey.repoPath, activeReviewKey.ref)
    : null;
  const active = status.refs.some((ref) => ref.reviewKey === activeKey);

  const label = status.subtitle
    ? `${index + 1}. ${status.title} — ${status.subtitle}`
    : `${index + 1}. ${status.title}`;

  return (
    <SimpleTooltip content={label} side={railTooltipSide("left")}>
      <button
        type="button"
        onClick={() => activateWorkItem(item)}
        aria-label={label}
        aria-current={active ? "true" : undefined}
        className={clsx(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded",
          "text-[11px] tabular-nums transition-colors duration-100",
          active ? "bg-surface-raised" : "hover:bg-fg/[0.08]",
          phase ? phaseTextClass(phase) : "text-fg-muted",
        )}
      >
        {index + 1}
      </button>
    </SimpleTooltip>
  );
}

/**
 * A terminal tab no work item has claimed. It gets a glyph rather than a number
 * because it has no position to stand for — it is reachable, not ranked.
 */
function TerminalRailDot({ tabId }: { tabId: string }): ReactNode {
  const glance = useTabGlance(tabId);
  if (!glance) return null;
  const { severity, allDead, title, primaryId } = glance;

  return (
    <SimpleTooltip
      content={<TerminalGlanceCard sessionId={primaryId} />}
      side={railTooltipSide("left")}
      contentClassName={RICH_TOOLTIP_CLASS}
    >
      <button
        type="button"
        onClick={() => jumpToTab(tabId)}
        aria-label={title}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded
                   transition-colors duration-100 hover:bg-fg/[0.08]"
      >
        <PhaseDot phase={severity ?? "idle"} dead={allDead} />
      </button>
    </SimpleTooltip>
  );
}
