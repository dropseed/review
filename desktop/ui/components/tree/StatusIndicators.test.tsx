import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { HunkCount } from "./StatusIndicators";
import type { FileHunkStatus } from "./types";

afterEach(cleanup);

function status(overrides: Partial<FileHunkStatus>): FileHunkStatus {
  return {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    trusted: 0,
    savedForLater: 0,
    ...overrides,
  };
}

describe("HunkCount", () => {
  it("shows a row's reviewed/rejected total as a single dim number, uncolored", () => {
    const { container } = render(
      <HunkCount
        status={status({ total: 5, approved: 3, rejected: 2 })}
        context="reviewed"
      />,
    );

    // The section header carries the color now — a row just reports size.
    expect(container.textContent).toBe("5");
    const span = container.querySelector("span");
    expect(span?.className).toContain("text-fg-muted");
    expect(span?.className).not.toContain("text-status-approved");
    expect(span?.className).not.toContain("text-status-rejected");
  });

  it("stays dim in the trusted context", () => {
    const { container } = render(
      <HunkCount status={status({ total: 4, trusted: 4 })} context="trusted" />,
    );

    expect(container.textContent).toBe("4");
    expect(container.querySelector("span")?.className).toContain(
      "text-fg-muted",
    );
    expect(container.querySelector("span")?.className).not.toContain(
      "text-status-trusted",
    );
  });

  it("keeps the colored fraction for the 'all' context outside the status sections", () => {
    const { container } = render(
      <HunkCount status={status({ total: 4, approved: 4 })} context="all" />,
    );

    expect(container.textContent).toBe("4/4");
    expect(container.querySelector("span")?.className).toContain(
      "text-status-approved",
    );
  });
});
