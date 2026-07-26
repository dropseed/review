import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import type { AgentUsage } from "../types";

const getAgentUsage = vi.fn<() => Promise<AgentUsage[]>>();

vi.mock("../api", () => ({
  getApiClient: () => ({ getAgentUsage }),
}));

import { AgentUsageIndicator } from "./AgentUsageIndicator";

const NOW_SECONDS = 1_800_000_000;
const HOUR = 3_600;
const DAY = 86_400;

/**
 * Claude states resets as local wall-clock prose, so build the wording from a
 * real instant rather than hard-coding a date the fake clock would drift from.
 */
function claudeResetText(secondsFromNow: number): string {
  const at = new Date((NOW_SECONDS + secondsFromNow) * 1000);
  const month = at.toLocaleString("en-US", { month: "short" });
  const minutes = String(at.getMinutes()).padStart(2, "0");
  const hour = at.getHours() % 12 || 12;
  const meridiem = at.getHours() < 12 ? "am" : "pm";
  return `${month} ${at.getDate()} at ${hour}:${minutes}${meridiem}`;
}

function claude(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    id: "claude",
    name: "Claude",
    windows: [
      {
        label: "Session",
        usedPercent: 8,
        resetsAtUnix: null,
        resetsAtText: claudeResetText(2 * HOUR),
        windowMinutes: 300,
      },
      {
        label: "Week (all models)",
        usedPercent: 86,
        resetsAtUnix: null,
        // Three days left of seven, so an even burn would be at 57%.
        resetsAtText: claudeResetText(3 * DAY),
        windowMinutes: 7 * 24 * 60,
      },
    ],
    plan: null,
    observedAtUnix: null,
    ...overrides,
  };
}

function codex(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    id: "codex",
    name: "Codex",
    windows: [
      {
        label: "Weekly",
        usedPercent: 30,
        resetsAtUnix: NOW_SECONDS + DAY,
        resetsAtText: null,
        windowMinutes: 7 * 24 * 60,
      },
    ],
    plan: "Plus",
    observedAtUnix: NOW_SECONDS - 120,
    ...overrides,
  };
}

function resolveWith(...agents: AgentUsage[]): void {
  getAgentUsage.mockResolvedValue(agents);
}

/** Render and advance past the hook's deferred first read. */
async function renderIndicator(): Promise<ReturnType<typeof render>> {
  const result = render(<AgentUsageIndicator />);
  await act(() => vi.advanceTimersByTimeAsync(6_000));
  return result;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW_SECONDS * 1000);
  getAgentUsage.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentUsageIndicator", () => {
  it("shows the most-constrained window as the headline number", async () => {
    resolveWith(claude());
    await renderIndicator();

    // 86% (weekly) is what will actually stop you, not the 8% session.
    const row = await screen.findByRole("button", { name: /Claude usage/ });
    expect(row.getAttribute("aria-label")).toContain("86%");
    expect(row.getAttribute("aria-label")).toContain("Week (all models)");
  });

  it("marks where an even burn would have you by now", async () => {
    resolveWith(claude());
    await renderIndicator();

    // Four of seven days gone, so the mark sits at 57% — well behind the 86%
    // already spent.
    const marker = await screen.findByTestId("pace-marker");
    expect(parseFloat(marker.style.left)).toBeCloseTo(57.14, 1);

    const row = screen.getByRole("button", { name: /Claude usage/ });
    expect(row.getAttribute("aria-label")).toContain("29% ahead of pace");
  });

  it("drops the mark when the window's length is unknown", async () => {
    resolveWith(
      claude({
        windows: [
          {
            label: "Fortnight",
            usedPercent: 40,
            resetsAtUnix: null,
            resetsAtText: claudeResetText(3 * DAY),
            windowMinutes: null,
          },
        ],
      }),
    );
    await renderIndicator();

    await screen.findByRole("button", { name: /Claude usage/ });
    expect(screen.queryByTestId("pace-marker")).toBeNull();
  });

  it("drops the mark for a snapshot whose window has already reset", async () => {
    resolveWith(
      codex({
        windows: [
          {
            label: "Weekly",
            usedPercent: 30,
            resetsAtUnix: NOW_SECONDS - 60,
            resetsAtText: null,
            windowMinutes: 7 * 24 * 60,
          },
        ],
      }),
    );
    await renderIndicator();

    await screen.findByRole("button", { name: /Codex usage/ });
    expect(screen.queryByTestId("pace-marker")).toBeNull();
  });

  it("renders a row per reporting agent", async () => {
    resolveWith(claude(), codex());
    await renderIndicator();

    await screen.findByRole("button", { name: /Claude usage/ });
    expect(screen.getByRole("button", { name: /Codex usage/ })).toBeDefined();
  });

  it("renders nothing when no agent reports limits", async () => {
    // An API-key user, or a machine with neither CLI installed.
    resolveWith();
    const { container } = await renderIndicator();

    await waitFor(() => expect(getAgentUsage).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("omits an agent the backend reports with no windows", async () => {
    resolveWith(claude(), codex({ windows: [] }));
    await renderIndicator();

    await screen.findByRole("button", { name: /Claude usage/ });
    expect(screen.queryByRole("button", { name: /Codex usage/ })).toBeNull();
  });

  it("blanks the percentage once a snapshot's windows have reset", async () => {
    // Codex last ran before the window rolled over — the number it recorded
    // describes a period that no longer exists.
    resolveWith(
      codex({
        windows: [
          {
            label: "Weekly",
            usedPercent: 30,
            resetsAtUnix: NOW_SECONDS - 60,
            resetsAtText: null,
            windowMinutes: 7 * 24 * 60,
          },
        ],
        observedAtUnix: NOW_SECONDS - 604_800,
      }),
    );
    await renderIndicator();

    const row = await screen.findByRole("button", { name: /Codex usage/ });
    expect(row.textContent).toContain("—");
    expect(row.textContent).not.toContain("30%");
  });

  it("keeps showing a live agent's number without a snapshot time", async () => {
    resolveWith(claude());
    await renderIndicator();

    const row = await screen.findByRole("button", { name: /Claude usage/ });
    expect(row.textContent).toContain("86%");
  });

  it("leaves the last known values in place when a refresh fails", async () => {
    resolveWith(claude());
    await renderIndicator();
    await screen.findByRole("button", { name: /Claude usage/ });

    getAgentUsage.mockRejectedValue(new Error("backend down"));
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000));

    // Still rendered — a failed poll is not an error state worth showing.
    expect(screen.getByRole("button", { name: /Claude usage/ })).toBeDefined();
  });
});
