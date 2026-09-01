import type { ReactNode } from "react";
import clsx from "clsx";
import { isTauriEnvironment } from "../api";
import { useBatteries } from "../hooks/useBatteries";
import {
  batteryDetail,
  batteryLabel,
  batteryTone,
  type BatteryTone,
} from "../utils/battery";
import type { Battery } from "../types";

/** The glyph's fill and the row's figures, once the level is worth noticing. */
const TONE_TEXT: Record<BatteryTone, string> = {
  critical: "text-status-rejected",
  warning: "text-status-warning",
  quiet: "text-fg-faint",
};

const TONE_FILL: Record<BatteryTone, string> = {
  critical: "fill-status-rejected",
  warning: "fill-status-warning",
  quiet: "fill-fg-faint",
};

/**
 * A battery drawn at its level: the outline, and a bar filling it.
 *
 * A real battery shape rather than the progress bar the usage rows use, because
 * this one has to be recognised rather than read — it is three rows down a
 * drawer someone opened to check something else entirely.
 */
function BatteryGlyph({
  percent,
  tone,
  charging,
}: {
  percent: number;
  tone: BatteryTone;
  charging: boolean;
}): ReactNode {
  // The inside of the shell, which is what the fill is a fraction of.
  const inner = 14;
  const filled = Math.max(1, Math.round((inner * percent) / 100));

  return (
    <svg
      className={clsx("h-3.5 w-3.5 shrink-0", TONE_TEXT[tone])}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect
        x="2"
        y="8"
        width="17"
        height="9"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* The terminal nub — the half of the shape that makes it a battery
          rather than a rounded rectangle. */}
      <path
        d="M21 11v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect
        x="3.5"
        y="9.5"
        width={filled}
        height="6"
        rx="1"
        className={TONE_FILL[tone]}
      />
      {/* On the cable, and drawn over the fill: at a glance the bolt is the
          answer to "do I need to go plug it in", which the level alone isn't.
          Filled in the glyph's own colour and outlined in the panel's, so it
          separates from the fill it sits on *and* stays visible on the empty
          part of the shell — a knockout would vanish over the second. */}
      {charging && (
        <path
          d="M12.2 8.9 8.2 13.4h2.5l-.6 3 3.9-4.4h-2.5z"
          fill="currentColor"
          stroke="var(--color-surface)"
          strokeWidth="1.1"
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      )}
    </svg>
  );
}

function BatteryRow({ battery }: { battery: Battery }): ReactNode {
  const tone = batteryTone(battery);
  const detail = batteryDetail(battery);

  return (
    <div
      className="flex items-center gap-2 px-1 py-0.5"
      // The glyph is a width and a colour; this is the same thing in words, for
      // a screen reader and for anyone hovering the row to be sure.
      title={batteryLabel(battery)}
    >
      <BatteryGlyph
        percent={battery.percent}
        tone={tone}
        charging={battery.state === "charging"}
      />
      <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-fg-muted">
        {battery.name}
      </span>
      {/* Before the percentage, not after it: the figures are what the eye runs
          down, and a detail that only some rows carry would push each of those
          rows' number to a different place. */}
      {detail && (
        <span className="shrink-0 text-[10px] leading-4 tabular-nums text-fg-faint">
          {detail}
        </span>
      )}
      <span
        className={clsx(
          "shrink-0 text-[11px] leading-4 tabular-nums",
          tone === "quiet" ? "text-fg-secondary" : TONE_TEXT[tone],
        )}
      >
        {battery.percent}%
      </span>
    </div>
  );
}

/**
 * The batteries on the machine serving this app — its own, and whatever is on
 * its desk.
 *
 * **Only for a client that is somewhere else.** This is the one fact a phone on
 * the tailnet cannot get any other way: the Mac running the terminals is not
 * the device in your hand, and a laptop that sleeps takes every session with
 * it. In the desktop shell the same number is in the menu bar a few
 * centimetres away, so drawing it here would be a second answer to a question
 * already answered — hence the gate on `isTauriEnvironment` rather than on
 * width. A browser at desktop width (an iPad, a laptop on the tailnet) is
 * remote in exactly the same way a phone is, and gets it too.
 *
 * A list rather than a control: this is something you open the drawer to glance
 * at, so every battery states itself and nothing has to be tapped. Empty is the
 * ordinary answer on most machines — a desktop Mac with no accessories, or a
 * host that is not a Mac — and renders nothing at all.
 */
export function BatteryIndicator(): ReactNode {
  if (isTauriEnvironment()) return null;
  return <RemoteBatteries />;
}

/**
 * Split from the gate so the hook is only subscribed where it is rendered —
 * `isTauriEnvironment` is constant for the life of the page, but a hook called
 * before an early return would poll the desktop app for a list it never draws.
 */
function RemoteBatteries(): ReactNode {
  const batteries = useBatteries();

  if (batteries.length === 0) return null;

  return (
    <div className="shrink-0 space-y-0.5 border-t border-t-edge/40 px-3 py-2">
      {batteries.map((battery) => (
        <BatteryRow key={battery.id} battery={battery} />
      ))}
    </div>
  );
}
