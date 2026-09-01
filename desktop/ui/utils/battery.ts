import type { Battery } from "../types";

/**
 * How much of a battery is worth reacting to, and when.
 *
 * The level alone decides, with one exception: a battery on the cable is going
 * up, so no figure it passes through on the way is news. That exception is what
 * keeps the sidebar from turning red every morning while the laptop fills.
 */
export type BatteryTone = "critical" | "warning" | "quiet";

/** Below this, a laptop is minutes from sleeping and its sessions with it. */
const CRITICAL_PERCENT = 10;
/** Below this, it is worth walking back to the desk before sending more work. */
const WARNING_PERCENT = 20;

export function batteryTone(battery: Battery): BatteryTone {
  if (battery.state === "charging" || battery.state === "charged") {
    return "quiet";
  }
  if (battery.percent <= CRITICAL_PERCENT) return "critical";
  if (battery.percent <= WARNING_PERCENT) return "warning";
  return "quiet";
}

/**
 * A countdown as "3h 24m" — or "45m" under the hour, where the leading "0h"
 * says nothing.
 *
 * Minutes are kept all the way up: this is read to decide whether there is time
 * for one more thing, and "3h" for anything between three and four hours is the
 * rounding that makes that decision wrong.
 */
export function formatRemaining(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

/**
 * The short trailing detail on a battery's row — the part that isn't the
 * percentage.
 *
 * `null` where there is nothing to add, which is most accessories (the
 * IORegistry reports a level and no state at all) and any battery macOS has no
 * estimate for yet.
 */
export function batteryDetail(battery: Battery): string | null {
  const remaining =
    battery.minutesRemaining === null
      ? null
      : formatRemaining(battery.minutesRemaining);

  switch (battery.state) {
    case "discharging":
      return remaining === null ? null : `${remaining} left`;
    case "charging":
      return remaining === null ? "charging" : `${remaining} to full`;
    case "charged":
      return "charged";
    case "pluggedNotCharging":
      return "plugged in";
    case "unknown":
      return null;
  }
}

/**
 * The row as a sentence: its accessible name, and its tooltip.
 *
 * Screen readers get the state in words rather than as a glyph filled to a
 * width, which is the whole of what the icon says.
 */
export function batteryLabel(battery: Battery): string {
  const detail = batteryDetail(battery);
  return detail === null
    ? `${battery.name}: ${battery.percent}%`
    : `${battery.name}: ${battery.percent}%, ${detail}`;
}
