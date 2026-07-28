import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

function renderTabs(children: React.ReactNode) {
  render(
    <Tabs value="one">
      <TabsList>
        <TabsTrigger value="one">{children}</TabsTrigger>
      </TabsList>
    </Tabs>,
  );
  return screen.getByRole("tab");
}

describe("TabsTrigger", () => {
  it("gives a text label a box that can ellipsize", () => {
    const trigger = renderTabs("A very long tab label");

    // `text-overflow` is inert on the flex trigger itself, so the label needs
    // an element of its own — otherwise a narrow panel clips it at both ends
    // rather than trailing off with an ellipsis.
    const label = trigger.querySelector(".truncate");
    expect(label?.textContent).toBe("A very long tab label");
    expect(trigger.className).not.toMatch(/\btruncate\b/);
  });

  it("leaves element children (the count badge) alone", () => {
    const trigger = renderTabs(
      <>
        Review
        <span data-testid="badge">12</span>
      </>,
    );

    expect(screen.getByTestId("badge").className).toBe("");
    expect(trigger.textContent).toBe("Review12");
  });
});
