import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

/**
 * The strip's scale chip, wired up.
 *
 * The thresholds and the wording are `view-scale.test.ts`. What is worth
 * rendering for is the subscription: the strip mounts *above* the pane, so the
 * chip's effect runs before anything has been laid out and the first scale can
 * only ever arrive as a notification. A chip that read the registry once would
 * be permanently absent.
 */

const mocks = vi.hoisted(() => ({
  scale: 1,
  listeners: [] as ((scale: number) => void)[],
  requestFit: vi.fn(),
}));

vi.mock("./registry", () => ({
  requestFit: mocks.requestFit,
  terminalViewScale: () => mocks.scale,
  onTerminalViewScale: (_id: string, listener: (scale: number) => void) => {
    mocks.listeners.push(listener);
    return () => {
      const at = mocks.listeners.indexOf(listener);
      if (at >= 0) mocks.listeners.splice(at, 1);
    };
  },
}));

import { TerminalScaleChip } from "./TerminalScaleChip";

/** What the pane publishes once it has measured itself. */
function publish(scale: number): void {
  mocks.scale = scale;
  act(() => {
    for (const listener of mocks.listeners) listener(scale);
  });
}

function chip(): HTMLElement | null {
  return screen.queryByRole("button", { name: /fit terminal to screen/i });
}

beforeEach(() => {
  mocks.scale = 1;
  mocks.listeners = [];
  render(<TerminalScaleChip paneId="t1" />);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the strip's scale chip", () => {
  it("says nothing before the pane has measured itself", () => {
    // An unmeasured pane reports 1 rather than 0 (see `publishLayout`), so the
    // strip is silent for the frame before the first layout instead of
    // flashing a chip claiming the terminal is drawn at nothing.
    expect(chip()).toBeNull();
  });

  it("appears on a scale the pane published after it mounted", () => {
    publish(0.62);
    expect(chip()?.textContent).toBe("62%");
  });

  it("fits the shared grid when tapped", () => {
    publish(0.62);
    act(() => chip()?.click());
    expect(mocks.requestFit).toHaveBeenCalledWith("t1");
  });

  it("goes away when the fit works", () => {
    publish(0.62);
    publish(1);
    expect(chip()).toBeNull();
  });

  it("stays quiet about a shrink nobody can see", () => {
    publish(0.98);
    expect(chip()).toBeNull();
  });
});
