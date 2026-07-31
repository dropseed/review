import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import type { AgentUsage } from "../types";

// Hoisted, because the component reaches the store, whose module initializer
// calls getApiClient() — that runs before a plain `const` mock is initialized.
const { getAgentUsage } = vi.hoisted(() => ({
  getAgentUsage: vi.fn<(force?: boolean) => Promise<AgentUsage[]>>(),
}));

vi.mock("../api", () => ({
  getApiClient: () => ({ getAgentUsage }),
}));

import { AgentUsageIndicator } from "./AgentUsageIndicator";
import { useReviewStore } from "../stores";

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

/** Claude's 5-hour window. Never the headline. */
function session(usedPercent: number) {
  return {
    label: "Session",
    usedPercent,
    resetsAtUnix: null,
    resetsAtText: claudeResetText(2 * HOUR),
    windowMinutes: 300,
    headline: false,
  };
}

/** Claude's weekly cap, three days from resetting — an even burn sits at 57%. */
function week(label: string, usedPercent: number) {
  return {
    label,
    usedPercent,
    resetsAtUnix: null,
    resetsAtText: claudeResetText(3 * DAY),
    windowMinutes: 7 * 24 * 60,
    headline: true,
  };
}

function claude(overrides: Partial<AgentUsage> = {}): AgentUsage {
  return {
    id: "claude",
    name: "Claude",
    windows: [session(8), week("Week (all models)", 86)],
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
        headline: true,
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
  // The store is a singleton, so a pin set by one test would follow the rest.
  useReviewStore.setState({ usagePinnedWindows: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentUsageIndicator", () => {
  it("shows the weekly window as the headline number", async () => {
    resolveWith(claude());
    await renderIndicator();

    // 86% (weekly) is the horizon worth the space, not the 8% session.
    const row = await screen.findByRole("button", { name: /Claude usage/ });
    expect(row.getAttribute("aria-label")).toContain("86%");
    expect(row.getAttribute("aria-label")).toContain("Week (all models)");
  });

  it("stays on the headline window even when the session is fuller", async () => {
    // The bar used to plot whichever window was closest to its cap, which meant
    // it silently changed meaning as the session overtook the week.
    resolveWith(
      claude({ windows: [session(94), week("Week (all models)", 21)] }),
    );
    await renderIndicator();

    const row = await screen.findByRole("button", { name: /Claude usage/ });
    expect(row.getAttribute("aria-label")).toContain("21%");
    expect(row.getAttribute("aria-label")).toContain("Week (all models)");
  });

  it("picks the fullest cap when an agent flags several as headline", async () => {
    resolveWith(
      claude({
        windows: [week("Week (all models)", 40), week("Week (Fable)", 77)],
      }),
    );
    await renderIndicator();

    const row = await screen.findByRole("button", { name: /Claude usage/ });
    expect(row.getAttribute("aria-label")).toContain("77%");
  });

  it("plots whichever window you pick from the popover", async () => {
    // The week is the default, but the session is what tells you whether to
    // start something right now.
    resolveWith(claude());
    await renderIndicator();

    const row = await screen.findByRole("button", { name: /^Claude usage:/ });
    expect(row.getAttribute("aria-label")).toContain("Week (all models)");

    await act(async () => {
      row.click();
    });
    await act(async () => {
      screen.getByRole("button", { name: /Show Session/ }).click();
    });

    await waitFor(() => {
      const label = screen
        .getByRole("button", { name: /^Claude usage:/ })
        .getAttribute("aria-label");
      expect(label).toContain("Session");
      expect(label).toContain("8%");
    });
  });

  it("returns to the default when you pick the pinned window again", async () => {
    resolveWith(claude());
    await renderIndicator();

    const row = await screen.findByRole("button", { name: /^Claude usage:/ });
    await act(async () => {
      row.click();
    });
    await act(async () => {
      screen.getByRole("button", { name: /Show Session/ }).click();
    });
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: /^Claude usage:/ })
          .getAttribute("aria-label"),
      ).toContain("Session");
    });

    // Clicking the shown one is the way back, without having to know which
    // window the default would have chosen.
    await act(async () => {
      screen
        .getByRole("button", { name: /Session, shown in the sidebar/ })
        .click();
    });
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: /^Claude usage:/ })
          .getAttribute("aria-label"),
      ).toContain("Week (all models)");
    });
  });

  it("falls back to the fullest window when nothing is flagged", async () => {
    resolveWith(claude({ windows: [session(63)] }));
    await renderIndicator();

    const row = await screen.findByRole("button", { name: /Claude usage/ });
    expect(row.getAttribute("aria-label")).toContain("63%");
    expect(row.getAttribute("aria-label")).toContain("Session");
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

  it("states the pace and the reset on one line", async () => {
    resolveWith(claude());
    await renderIndicator();

    await act(async () => {
      (await screen.findByRole("button", { name: /^Claude usage:/ })).click();
    });

    // How far into the window we are is the mark's job, so the words carry
    // only which side of it we're on and when the window ends.
    expect(
      await screen.findByText("29% ahead of pace · resets in 3d"),
    ).toBeTruthy();
    expect(screen.queryByText(/window elapsed/)).toBeNull();
  });

  it("leads with the reset when there's no pace to state", async () => {
    resolveWith(
      claude({
        windows: [
          {
            label: "Fortnight",
            usedPercent: 40,
            resetsAtUnix: null,
            resetsAtText: claudeResetText(3 * DAY),
            windowMinutes: null,
            headline: false,
          },
        ],
      }),
    );
    await renderIndicator();

    await act(async () => {
      (await screen.findByRole("button", { name: /^Claude usage:/ })).click();
    });

    expect(await screen.findByText("Resets in 3d")).toBeTruthy();
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
            headline: false,
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
            headline: true,
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
            headline: true,
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

  it("re-reads usage on demand, bypassing the cached read", async () => {
    resolveWith(claude());
    await renderIndicator();

    // The popover holds the refresh control, so open the row first.
    const row = await screen.findByRole("button", { name: /Claude usage/ });
    await act(async () => {
      row.click();
    });

    resolveWith(claude({ windows: [week("Week (all models)", 3)] }));

    const refreshButton = await screen.findByRole("button", {
      name: /Refresh usage/,
    });
    await act(async () => {
      refreshButton.click();
    });

    await waitFor(() => {
      // The force flag is what distinguishes this from the ambient poll.
      expect(getAgentUsage).toHaveBeenCalledWith(true);
      expect(
        screen
          .getByRole("button", { name: /^Claude usage:/ })
          .getAttribute("aria-label"),
      ).toContain("3%");
    });
  });
});
