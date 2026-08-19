import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { PhaseDot } from "./PhaseDot";
import type { TerminalPhase } from "../../types";

afterEach(cleanup);

function marker(container: HTMLElement): string {
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

/** The knock is one-shot, so every assertion about it is about a transition. */
function renderAt(phase: TerminalPhase, dead = false) {
  const view = render(<PhaseDot phase={phase} dead={dead} />);
  return {
    className: () => marker(view.container),
    moveTo: (next: TerminalPhase) =>
      act(() => {
        view.rerender(<PhaseDot phase={next} dead={dead} />);
      }),
  };
}

describe("PhaseDot", () => {
  it("colors `working` apart from the amber that means a workspace wants you", () => {
    expect(renderAt("working").className()).toContain("text-phase-working");
    expect(renderAt("working").className()).not.toContain("status-warning");
  });

  it("knocks once when a session stops for a person", () => {
    const dot = renderAt("working");
    expect(dot.className()).not.toContain("animate-attention-knock");

    dot.moveTo("waiting_for_input");
    expect(dot.className()).toContain("animate-attention-knock");
  });

  it("holds still while a session is only busy", () => {
    const dot = renderAt("idle");
    dot.moveTo("working");
    expect(dot.className()).not.toContain("animate-attention-knock");
  });

  /**
   * The rule that keeps opening the sidebar from setting every waiting row
   * moving at once: a marker knocks for a change it watched, never for the
   * state it was handed.
   */
  it("does not knock for the phase it mounts into", () => {
    expect(renderAt("needs_attention").className()).not.toContain(
      "animate-attention-knock",
    );
  });

  it("does not knock for a session that has exited", () => {
    const dot = renderAt("working", true);
    dot.moveTo("needs_attention");
    expect(dot.className()).not.toContain("animate-attention-knock");
  });

  it("stops after one knock rather than looping", () => {
    vi.useFakeTimers();
    try {
      const dot = renderAt("working");
      dot.moveTo("needs_attention");
      expect(dot.className()).toContain("animate-attention-knock");

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(dot.className()).not.toContain("animate-attention-knock");
    } finally {
      vi.useRealTimers();
    }
  });
});
