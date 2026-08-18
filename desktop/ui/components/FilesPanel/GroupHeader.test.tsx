import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GroupHeader } from "./GroupHeader";

afterEach(cleanup);

describe("GroupHeader", () => {
  it("renders a tinted count pill in place of the plain fraction when countTone is set", () => {
    render(
      <GroupHeader
        title="Needs Review"
        progress={{ done: 0, total: 3 }}
        countTone="pending"
        isExpanded={false}
        onToggleExpanded={() => {}}
      />,
    );

    // No "done/total" fraction — just the count, tinted for the bucket.
    expect(screen.queryByText("0/3")).toBeNull();
    const pill = screen.getByText("3");
    expect(pill.className).toContain("bg-status-pending/20");
    expect(pill.className).toContain("text-status-pending");
  });

  it("keeps a zero count visible but muted rather than hiding it", () => {
    render(
      <GroupHeader
        title="Trusted"
        progress={{ done: 0, total: 0 }}
        countTone="trusted"
        isExpanded={false}
        onToggleExpanded={() => {}}
      />,
    );

    const pill = screen.getByText("0");
    expect(pill.className).toContain("bg-fg/10");
    expect(pill.className).toContain("text-fg-faint");
    expect(pill.className).not.toContain("text-status-trusted");
  });

  it("falls back to the plain done/total fraction when no tone is given", () => {
    render(
      <GroupHeader
        title="Commit A"
        progress={{ done: 2, total: 5 }}
        isExpanded={false}
        onToggleExpanded={() => {}}
      />,
    );

    expect(screen.getByText("2/5")).toBeTruthy();
  });

  it("keeps actionContent visible next to the overflow menu, unlike the hover-only quickAction", () => {
    render(
      <GroupHeader
        title="Reviewed"
        progress={{ done: 1, total: 1 }}
        isExpanded={false}
        onToggleExpanded={() => {}}
        actionContent={<button aria-label="View as rolling diff">R</button>}
        menuContent={<div>menu</div>}
      />,
    );

    const button = screen.getByLabelText("View as rolling diff");
    // Not gated behind the hover-reveal opacity classes quickAction uses.
    expect(button.className).not.toContain("opacity-0");
    expect(screen.getByLabelText("More actions")).toBeTruthy();
  });

  it("fires actionContent's own click handler", () => {
    const onAction = vi.fn();
    render(
      <GroupHeader
        title="Reviewed"
        progress={{ done: 1, total: 1 }}
        isExpanded={false}
        onToggleExpanded={() => {}}
        actionContent={
          <button aria-label="rolling-diff" onClick={onAction}>
            R
          </button>
        }
      />,
    );

    screen.getByLabelText("rolling-diff").click();
    expect(onAction).toHaveBeenCalledOnce();
  });
});
