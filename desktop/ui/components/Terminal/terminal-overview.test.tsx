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
// The panes stand in for their terminals: this suite is about which of them
// the row draws and where clicking one takes you, and a real xterm wants a
// canvas and a `matchMedia` jsdom does not have.
vi.mock("./TerminalPane", () => ({
  TerminalPane: ({ id }: { id: string }) => <div data-testid={`pane-${id}`} />,
}));

import { TerminalOverview } from "./TerminalOverview";
import { makeTab } from "./pane-tree";
import { useSpurStore } from "../../stores";
import {
  terminalSession,
  terminalStatus,
  workspace,
} from "../../test/fixtures";

/** Two workspaces, one terminal each — the case the row exists for. */
function twoWorkspaces() {
  useSpurStore.setState({
    workspaces: [workspace("w1", { title: "First" }), workspace("w2")],
    terminalTabs: [makeTab("tab-a", "a"), makeTab("tab-b", "b")],
    terminalSessions: {
      a: terminalSession("a", { workspaceId: "w1" }),
      b: terminalSession("b", { workspaceId: "w2" }),
    },
    terminalStatuses: {
      a: terminalStatus("working", { id: "a", title: "agent" }),
      b: terminalStatus("idle", { id: "b", title: "zsh" }),
    },
    terminalOverview: true,
  });
}

afterEach(() => {
  cleanup();
  useSpurStore.setState({
    workspaces: [],
    focusedWorkspaceId: null,
    terminalTabs: [],
    terminalSessions: {},
    terminalStatuses: {},
    terminalExited: {},
    activeTabId: null,
    terminalOverview: false,
  });
});

describe("the terminal overview", () => {
  it("draws a column for every workspace's terminals, not just the focused one", () => {
    twoWorkspaces();
    useSpurStore.setState({ focusedWorkspaceId: "w1" });
    render(<TerminalOverview />);

    expect(screen.getByText("agent")).toBeDefined();
    expect(screen.getByText("zsh")).toBeDefined();
    // Each is placed by the card it belongs to — that is how you find one.
    expect(screen.getByText("First")).toBeDefined();
    expect(screen.getByText("Untitled")).toBeDefined();
  });

  it("takes you to the terminal whose header you clicked", () => {
    twoWorkspaces();
    render(<TerminalOverview />);

    fireEvent.click(screen.getByText("zsh"));

    const state = useSpurStore.getState();
    expect(state.focusedWorkspaceId).toBe("w2");
    // The tab you pointed at, rather than that workspace's most recent one.
    expect(state.activeTabId).toBe("tab-b");
    // And the row closes behind you: it is a place you look from.
    expect(state.terminalOverview).toBe(false);
  });

  it("closes from its own header, for a collapsed sidebar", () => {
    twoWorkspaces();
    render(<TerminalOverview />);

    fireEvent.click(screen.getByLabelText("Close terminal overview"));

    expect(useSpurStore.getState().terminalOverview).toBe(false);
  });

  it("says nothing is running rather than showing an empty row", () => {
    useSpurStore.setState({ terminalOverview: true });
    render(<TerminalOverview />);

    expect(screen.getByText("Nothing is running.")).toBeDefined();
  });
});
