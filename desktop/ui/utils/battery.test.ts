import { describe, expect, it } from "vitest";
import {
  batteryDetail,
  batteryLabel,
  batteryTone,
  formatRemaining,
} from "./battery";
import type { Battery } from "../types";

function battery(overrides: Partial<Battery> = {}): Battery {
  return {
    id: "internal",
    name: "Mac",
    percent: 62,
    state: "discharging",
    minutesRemaining: 204,
    internal: true,
    ...overrides,
  };
}

describe("formatRemaining", () => {
  it("keeps the minutes beside the hours", () => {
    // "3h" for anything from three to four hours is the rounding that makes
    // "is there time for one more run" the wrong answer.
    expect(formatRemaining(204)).toBe("3h 24m");
  });

  it("drops an hours place that would read as zero", () => {
    expect(formatRemaining(45)).toBe("45m");
  });
});

describe("batteryTone", () => {
  it("stays quiet at the levels a laptop spends its day at", () => {
    expect(batteryTone(battery({ percent: 62 }))).toBe("quiet");
  });

  it("warns before the level that ends the session", () => {
    expect(batteryTone(battery({ percent: 18 }))).toBe("warning");
    expect(batteryTone(battery({ percent: 7 }))).toBe("critical");
  });

  /** A battery on the cable is going up, so no level it passes is news. */
  it("never alarms about a battery that is filling", () => {
    expect(batteryTone(battery({ percent: 4, state: "charging" }))).toBe(
      "quiet",
    );
  });

  /**
   * An accessory reports a level and no state at all, so a mouse about to die
   * would never alarm if the warning were gated on "discharging".
   */
  it("alarms about a low accessory despite its unknown state", () => {
    expect(
      batteryTone(
        battery({
          id: "Magic Mouse",
          percent: 6,
          state: "unknown",
          minutesRemaining: null,
          internal: false,
        }),
      ),
    ).toBe("critical");
  });
});

describe("batteryDetail", () => {
  it("counts down while discharging", () => {
    expect(batteryDetail(battery())).toBe("3h 24m left");
  });

  it("counts up while charging", () => {
    expect(
      batteryDetail(battery({ state: "charging", minutesRemaining: 65 })),
    ).toBe("1h 5m to full");
  });

  /**
   * macOS reports no estimate for the first minutes after a cable moves.
   * Saying nothing is right; "0m left" would be an alarm about nothing.
   */
  it("says nothing rather than zero when there is no estimate yet", () => {
    expect(batteryDetail(battery({ minutesRemaining: null }))).toBeNull();
    expect(
      batteryDetail(battery({ state: "charging", minutesRemaining: null })),
    ).toBe("charging");
  });

  it("names the state macOS holds a plugged-in battery in", () => {
    expect(
      batteryDetail(
        battery({
          percent: 80,
          state: "pluggedNotCharging",
          minutesRemaining: null,
        }),
      ),
    ).toBe("plugged in");
  });

  it("has nothing to add about an accessory", () => {
    expect(
      batteryDetail(
        battery({ state: "unknown", minutesRemaining: null, internal: false }),
      ),
    ).toBeNull();
  });
});

describe("batteryLabel", () => {
  it("spells out what the glyph draws", () => {
    expect(batteryLabel(battery())).toBe("Mac: 62%, 3h 24m left");
  });

  it("stops at the percentage when there is nothing else to say", () => {
    expect(
      batteryLabel(
        battery({
          id: "Magic Trackpad",
          name: "Magic Trackpad",
          percent: 41,
          state: "unknown",
          minutesRemaining: null,
          internal: false,
        }),
      ),
    ).toBe("Magic Trackpad: 41%");
  });
});
