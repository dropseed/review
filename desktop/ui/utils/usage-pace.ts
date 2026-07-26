import type { UsageWindow } from "../types";

/**
 * Where a straight-line burn would have you by now, as a percentage of the
 * window — the "on pace" mark. Spending the week evenly traces this line, so
 * usage above it is running hot and usage below it has room.
 *
 * `null` when the window can't be placed in time: no known length, no reset
 * time, or a reset that has already passed.
 */
export function pacePercent(
  window: UsageWindow,
  nowSeconds: number,
): number | null {
  if (window.windowMinutes === null || window.windowMinutes <= 0) return null;

  const resetsAt = windowResetsAt(window, nowSeconds);
  if (resetsAt === null || resetsAt <= nowSeconds) return null;

  const durationSeconds = window.windowMinutes * 60;
  const elapsed = durationSeconds - (resetsAt - nowSeconds);
  return Math.min(100, Math.max(0, (elapsed / durationSeconds) * 100));
}

/** The window's reset instant in unix seconds, however the agent expressed it. */
function windowResetsAt(
  window: UsageWindow,
  nowSeconds: number,
): number | null {
  if (window.resetsAtUnix !== null) return window.resetsAtUnix;
  if (window.resetsAtText === null) return null;
  return parseResetText(window.resetsAtText, nowSeconds);
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** `Jul 28 at 1:59pm (America/Chicago)`, with the minutes and zone optional. */
const RESET_TEXT =
  /^([a-z]{3})[a-z]*\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

/**
 * Parse Claude's reset wording into unix seconds.
 *
 * Claude prints a month and day but no year, so the year is the one that lands
 * the date nearest to now — a window that resets in early January is stated in
 * December. The named zone is ignored and the time read as local: Claude
 * reports in the machine's own zone, and the two only diverge if the user has
 * configured a different one, which shifts the mark by hours at most.
 *
 * This is human-facing text with no stability guarantee, so anything that
 * doesn't match yields `null` — a reworded line should drop the pace mark, not
 * misplace it.
 */
export function parseResetText(
  text: string,
  nowSeconds: number,
): number | null {
  const match = RESET_TEXT.exec(text.trim());
  if (!match) return null;

  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;

  const day = Number(match[2]);
  const minute = match[4] === undefined ? 0 : Number(match[4]);
  const meridiem = match[5].toLowerCase();
  let hour = Number(match[3]) % 12;
  if (meridiem === "pm") hour += 12;

  const nowMs = nowSeconds * 1000;
  const thisYear = new Date(nowMs).getFullYear();

  let best: number | null = null;
  for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
    const candidate = new Date(year, month, day, hour, minute).getTime();
    if (Number.isNaN(candidate)) continue;
    if (best === null || Math.abs(candidate - nowMs) < Math.abs(best - nowMs)) {
      best = candidate;
    }
  }

  return best === null ? null : Math.round(best / 1000);
}

/**
 * How the used percentage compares to the pace mark, phrased for a reader.
 * `null` when there's no mark, or when the gap is too small to be worth words.
 */
export function formatPaceDelta(
  usedPercent: number,
  pace: number,
): string | null {
  const delta = Math.round(usedPercent - pace);
  if (delta === 0) return null;
  return delta > 0 ? `${delta}% ahead of pace` : `${-delta}% under pace`;
}
