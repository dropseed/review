import { describe, it, expect } from "vitest";
import { pacePercent, parseResetText, formatPaceDelta } from "./usage-pace";
import type { UsageWindow } from "../types";

const WEEK_MINUTES = 7 * 24 * 60;
const DAY = 86_400;

function window(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return {
    label: "Weekly",
    usedPercent: 50,
    resetsAtUnix: null,
    resetsAtText: null,
    windowMinutes: WEEK_MINUTES,
    headline: true,
    ...overrides,
  };
}

describe("pacePercent", () => {
  it("places now in the window from its reset time and length", () => {
    // Two days left of seven means five sevenths of the week is gone.
    const pace = pacePercent(
      window({ resetsAtUnix: 1_000_000 + 2 * DAY }),
      1_000_000,
    );
    expect(pace).toBeCloseTo((5 / 7) * 100, 5);
  });

  it("has no answer for a window of unknown length", () => {
    // Claude names windows we don't recognize; guessing would misplace the mark.
    expect(
      pacePercent(
        window({ windowMinutes: null, resetsAtUnix: 1_000_000 + DAY }),
        1_000_000,
      ),
    ).toBeNull();
  });

  it("has no answer without a reset time", () => {
    expect(pacePercent(window(), 1_000_000)).toBeNull();
  });

  it("has no answer once the reset has passed", () => {
    // A stale snapshot describes a window that has already rolled over.
    expect(
      pacePercent(window({ resetsAtUnix: 1_000_000 - 60 }), 1_000_000),
    ).toBeNull();
  });

  it("derives the reset time from Claude's wording", () => {
    const now = new Date(2026, 6, 25, 14, 0).getTime() / 1000;
    const pace = pacePercent(
      window({ resetsAtText: "Jul 28 at 2pm (America/Chicago)" }),
      now,
    );
    // Three days to go: four of seven days elapsed.
    expect(pace).toBeCloseTo((4 / 7) * 100, 5);
  });
});

describe("parseResetText", () => {
  const now = new Date(2026, 6, 25, 14, 0).getTime() / 1000;

  it("reads a time with minutes", () => {
    expect(parseResetText("Jul 28 at 1:59pm (America/Chicago)", now)).toBe(
      new Date(2026, 6, 28, 13, 59).getTime() / 1000,
    );
  });

  it("reads a time on the hour, with no zone", () => {
    expect(parseResetText("Jul 26 at 2am", now)).toBe(
      new Date(2026, 6, 26, 2, 0).getTime() / 1000,
    );
  });

  it("reads noon and midnight the way the clock does", () => {
    expect(parseResetText("Jul 26 at 12pm", now)).toBe(
      new Date(2026, 6, 26, 12, 0).getTime() / 1000,
    );
    expect(parseResetText("Jul 26 at 12am", now)).toBe(
      new Date(2026, 6, 26, 0, 0).getTime() / 1000,
    );
  });

  it("picks the year that lands the date nearest now", () => {
    // A window resetting in early January is stated in late December.
    const december = new Date(2026, 11, 30, 9, 0).getTime() / 1000;
    expect(parseResetText("Jan 2 at 9am", december)).toBe(
      new Date(2027, 0, 2, 9, 0).getTime() / 1000,
    );
  });

  it("gives up on wording it doesn't recognize", () => {
    // The line is human-facing prose; a rewording should drop the mark, not
    // move it somewhere wrong.
    expect(parseResetText("in about 3 days", now)).toBeNull();
    expect(parseResetText("Smarch 4 at 2pm", now)).toBeNull();
  });
});

describe("formatPaceDelta", () => {
  it("says which side of the line usage is on", () => {
    expect(formatPaceDelta(86, 57)).toBe("29% ahead of pace");
    expect(formatPaceDelta(30, 57)).toBe("27% under pace");
  });

  it("says nothing when the gap rounds away", () => {
    expect(formatPaceDelta(57.2, 57)).toBeNull();
  });
});
