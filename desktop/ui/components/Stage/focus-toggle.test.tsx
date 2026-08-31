import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

import { FocusToggle, type StageHalf } from "./FocusToggle";
import { TooltipProvider } from "../ui/tooltip";
import { useSpurStore } from "../../stores";

function show(half: StageHalf) {
  render(
    <TooltipProvider>
      <FocusToggle half={half} />
    </TooltipProvider>,
  );
}

function focus(): string {
  return useSpurStore.getState().contentFocus;
}

afterEach(() => {
  cleanup();
  useSpurStore.setState({ contentFocus: "split" });
  vi.clearAllMocks();
});

describe("a half's Focus button", () => {
  it("gives its own half the stage, and hands it back", () => {
    show("terminal");

    fireEvent.click(screen.getByLabelText("Full view"));
    expect(focus()).toBe("terminal");

    fireEvent.click(screen.getByLabelText("Exit full view"));
    expect(focus()).toBe("split");
  });

  it("does the same for the code half", () => {
    show("code");

    fireEvent.click(screen.getByLabelText("Full view"));
    expect(focus()).toBe("code");

    fireEvent.click(screen.getByLabelText("Exit full view"));
    expect(focus()).toBe("split");
  });

  /**
   * The two bars are never both hidden, so the button that took the stage is
   * the one still on screen — it has to read as the way out.
   */
  it("wears the focused state only for its own half", () => {
    useSpurStore.setState({ contentFocus: "terminal" });
    show("terminal");

    expect(
      screen.getByLabelText("Exit full view").getAttribute("aria-pressed"),
    ).toBe("true");

    cleanup();
    show("code");
    expect(
      screen.getByLabelText("Full view").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  /** Focusing one half from the other's focus is one click, not two. */
  it("takes the stage straight from the other half's focus", () => {
    useSpurStore.setState({ contentFocus: "terminal" });
    show("code");

    fireEvent.click(screen.getByLabelText("Full view"));
    expect(focus()).toBe("code");
  });
});
