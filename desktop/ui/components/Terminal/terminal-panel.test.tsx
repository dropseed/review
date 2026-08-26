import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
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

import { TerminalPanel } from "./TerminalPanel";
import { TooltipProvider } from "../ui/tooltip";
import { useReviewStore } from "../../stores";

function show() {
  render(
    <TooltipProvider>
      <TerminalPanel />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  useReviewStore.setState({
    terminalTabs: [],
    terminalSessions: {},
    activeTabId: null,
    contentFocus: "split",
    workspaces: [],
    focusedWorkspaceId: null,
  });
  vi.clearAllMocks();
});

describe("the terminal strip's controls", () => {
  /**
   * Splitting is a gesture on the pane you want to split, so the strip's "+"
   * is one verb with no menu in front of it.
   */
  it("starts a tab from the + itself, offering no options", () => {
    const startTerminal = vi.fn().mockResolvedValue("t1");
    useReviewStore.setState({ startTerminal } as never);
    show();

    expect(screen.queryByLabelText("New terminal options")).toBeNull();

    fireEvent.click(screen.getByLabelText("New terminal tab"));
    expect(startTerminal).toHaveBeenCalled();
  });

  it("carries this half's Focus toggle", () => {
    show();

    fireEvent.click(screen.getByLabelText("Full view"));
    expect(useReviewStore.getState().contentFocus).toBe("terminal");
    expect(screen.getByLabelText("Exit full view")).toBeDefined();
  });
});

describe("the terminal strip at phone width", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  /**
   * The strip is the phone's whole navigation now that the bottom tab bar is
   * gone: the code half is one tap from the terminal, and it pushes a screen
   * rather than switching a tab.
   */
  it("reaches the code half from the strip itself", () => {
    show();

    fireEvent.click(screen.getByLabelText("Code"));
    expect(useReviewStore.getState().contentFocus).toBe("code");
  });

  /**
   * A hover-revealed control has no hover to reveal it, and the back button on
   * the pushed screen already says the same thing in words.
   */
  it("drops the Focus toggle, which a finger could never reveal", () => {
    show();

    expect(screen.queryByLabelText("Full view")).toBeNull();
  });

  /** Text size moved into the overflow sheet, now that a pinch does it too. */
  it("keeps the text-size steps out of the strip", () => {
    show();

    expect(screen.queryByLabelText("Bigger terminal text")).toBeNull();
  });
});
