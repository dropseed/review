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
