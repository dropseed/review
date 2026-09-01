import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import type { Battery } from "../types";

/**
 * The battery block: who it draws for, and what it draws.
 *
 * The gate is the part worth a render test. This exists for a client looking at
 * a machine it is not sitting at — the phone on the tailnet — and the desktop
 * shell must not merely hide it but never ask for it, since asking spawns two
 * subprocesses a minute to answer a question the menu bar already answers.
 */

const mocks = vi.hoisted(() => ({
  tauri: false,
  batteries: [] as Battery[],
  getBatteries: vi.fn(),
}));

vi.mock("../api", () => ({
  isTauriEnvironment: () => mocks.tauri,
  getApiClient: () => ({ getBatteries: mocks.getBatteries }),
}));

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

/** Mount the block on a fresh copy of the hook's module-level poll. */
async function mount(): Promise<void> {
  const { BatteryIndicator } = await import("./BatteryIndicator");
  render(<BatteryIndicator />);
  // The first read is issued from the subscription, so the rows only exist
  // once its promise has settled.
  await act(async () => {});
}

beforeEach(() => {
  vi.resetModules();
  mocks.tauri = false;
  mocks.batteries = [];
  mocks.getBatteries = vi.fn(async () => mocks.batteries);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the battery block", () => {
  it("draws a row per battery for a client that is somewhere else", async () => {
    mocks.batteries = [
      battery(),
      battery({
        id: "Magic Trackpad",
        name: "Magic Trackpad",
        percent: 41,
        state: "unknown",
        minutesRemaining: null,
        internal: false,
      }),
    ];
    await mount();

    expect(screen.getByTitle("Mac: 62%, 3h 24m left")).toBeTruthy();
    expect(screen.getByTitle("Magic Trackpad: 41%")).toBeTruthy();
  });

  /**
   * The whole point of the gate: on the Mac itself this number is in the menu
   * bar, and polling for it would be two subprocesses a minute spent restating
   * what the OS already says.
   */
  it("draws nothing in the desktop shell, and does not even ask", async () => {
    mocks.tauri = true;
    mocks.batteries = [battery()];
    await mount();

    expect(screen.queryByTitle(/Mac:/)).toBeNull();
    expect(mocks.getBatteries).not.toHaveBeenCalled();
  });

  /**
   * A desktop Mac with no accessories, or a host that is not a Mac. Empty is an
   * answer, not a loading state, so there is nothing to hold room for.
   */
  it("draws nothing when the host reports no batteries", async () => {
    await mount();

    expect(mocks.getBatteries).toHaveBeenCalled();
    expect(screen.queryByTitle(/%/)).toBeNull();
  });

  /**
   * Ambient chrome: a phone that has just lost its tailnet route should keep
   * showing the last charge rather than an error it cannot act on.
   */
  it("survives a failed read without throwing", async () => {
    mocks.getBatteries = vi.fn(async () => {
      throw new Error("no route to host");
    });
    await mount();

    expect(screen.queryByTitle(/%/)).toBeNull();
  });
});
