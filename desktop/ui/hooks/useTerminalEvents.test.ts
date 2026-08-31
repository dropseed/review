import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";

const {
  terminalList,
  onTerminalStatusChanged,
  terminalsAvailable,
  onTerminalStarted,
  onTerminalExited,
  onTerminalWorkspaceAssigned,
  onTerminalRemoved,
  onTerminalSessionsInvalidated,
} = vi.hoisted(() => ({
  terminalList: vi.fn(),
  onTerminalStatusChanged: vi.fn(),
  terminalsAvailable: vi.fn(),
  onTerminalStarted: vi.fn(),
  onTerminalExited: vi.fn(),
  onTerminalWorkspaceAssigned: vi.fn(),
  onTerminalRemoved: vi.fn(),
  onTerminalSessionsInvalidated: vi.fn(),
}));

vi.mock("../api", () => ({
  getApiClient: () => ({
    terminalList,
    onTerminalStatusChanged,
    terminalsAvailable,
    onTerminalStarted,
    onTerminalExited,
    onTerminalWorkspaceAssigned,
    onTerminalRemoved,
    onTerminalSessionsInvalidated,
    terminalReplay: () => Promise.resolve({ data: "", status: null }),
    onTerminalOutput: () => () => undefined,
    onTerminalExit: () => () => undefined,
  }),
  isTauriEnvironment: () => false,
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useSpurStore } from "../stores";
import { useTerminalEvents } from "./useTerminalEvents";
import { terminalSession } from "../test/fixtures";

/** The callback the hook handed to a global subscribe, once it has. */
function handlerOf<T>(mock: {
  mock: { calls: unknown[][] };
}): (arg: T) => void {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("not subscribed");
  return call[0] as (arg: T) => void;
}

beforeEach(() => {
  terminalList.mockReset().mockResolvedValue([]);
  onTerminalStatusChanged.mockReset().mockReturnValue(() => undefined);
  terminalsAvailable.mockReset().mockResolvedValue(true);
  for (const mock of [
    onTerminalStarted,
    onTerminalExited,
    onTerminalWorkspaceAssigned,
    onTerminalRemoved,
    onTerminalSessionsInvalidated,
  ]) {
    mock.mockReset().mockReturnValue(() => undefined);
  }
  useSpurStore.setState({
    repoPath: null,
    reviewRef: null,
    terminalsSupported: true,
    terminalSessions: {},
    terminalStatuses: {},
    terminalExited: {},
    terminalTabs: [],
    activeTabId: null,
  } as never);
});

afterEach(() => cleanup());

describe("useTerminalEvents", () => {
  // The daemon is global, so the home screen has terminals too — gating the
  // load on a repo left the dock empty until one was opened.
  it("loads sessions and subscribes with no repo open", async () => {
    renderHook(() => useTerminalEvents());

    await waitFor(() => expect(terminalList).toHaveBeenCalled());
    expect(onTerminalStatusChanged).toHaveBeenCalled();
    expect(onTerminalStarted).toHaveBeenCalled();
  });

  // The point of the whole event channel: a terminal born on the phone (or by
  // the CLI, or in another window) reaches this one as an announcement, not as
  // something a poll eventually notices.
  it("lands a session announced by `started`, with no list call", async () => {
    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(onTerminalStarted).toHaveBeenCalled());
    terminalList.mockClear();

    handlerOf(onTerminalStarted)(terminalSession("phone-1"));

    await waitFor(() =>
      expect(useSpurStore.getState().terminalSessions["phone-1"]).toBeDefined(),
    );
    // A tab too — the session is on screen, not merely in a map.
    expect(
      useSpurStore.getState().terminalTabs.some((t) => t.id === "phone-1"),
    ).toBe(true);
    expect(terminalList).not.toHaveBeenCalled();
  });

  // The stream admitting it may have missed something is the one thing that
  // still costs a list.
  it("re-lists when the stream reports itself incomplete", async () => {
    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(1));

    terminalList.mockResolvedValue([terminalSession("ws-born")]);
    handlerOf<void>(onTerminalSessionsInvalidated)(undefined as never);

    await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(useSpurStore.getState().terminalSessions["ws-born"]).toBeDefined(),
    );
  });

  // The backstop under the stream: whatever happened while this window's
  // connection was down was announced to nobody, and coming back to the window
  // is when a stale list is most likely to be looked at.
  it("re-lists on focus", async () => {
    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(1));

    terminalList.mockResolvedValue([terminalSession("phone-1")]);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(useSpurStore.getState().terminalSessions["phone-1"]).toBeDefined(),
    );
  });

  // Four things ask for the list and at launch two of them fire back-to-back.
  // Two answers in flight at once can land in either order, and the older one
  // would ingest a session list from before the newer one's.
  it("keeps one list in flight, re-running once for whatever asked meanwhile", async () => {
    let answer: ((sessions: unknown[]) => void) | null = null;
    terminalList.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(1));

    // Two more asks while the first answer is still out.
    const first = answer!;
    window.dispatchEvent(new Event("focus"));
    handlerOf<void>(onTerminalSessionsInvalidated)(undefined as never);
    expect(terminalList).toHaveBeenCalledTimes(1);

    // One re-run for both of them, once the answer lands.
    first([]);
    await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(2));
  });

  // The subscriptions are global and the list is unfiltered, so neither has
  // anything to do with the repo on screen — tearing six of them down and
  // re-listing on every repo switch bought nothing.
  it("does not resubscribe when the repo changes", async () => {
    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(terminalList).toHaveBeenCalledTimes(1));

    act(() => useSpurStore.setState({ repoPath: "/other" } as never));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onTerminalStarted).toHaveBeenCalledTimes(1);
    expect(onTerminalStatusChanged).toHaveBeenCalledTimes(1);
    expect(terminalList).toHaveBeenCalledTimes(1);
  });

  // Attribution lives on the session and any client may move it.
  it("re-attributes a session moved somewhere else", async () => {
    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(onTerminalWorkspaceAssigned).toHaveBeenCalled());
    handlerOf(onTerminalStarted)(
      terminalSession("t1", { workspaceId: "ws-a" }),
    );

    handlerOf(onTerminalWorkspaceAssigned)({ id: "t1", workspaceId: "ws-b" });

    await waitFor(() =>
      expect(useSpurStore.getState().terminalSessions["t1"]?.workspaceId).toBe(
        "ws-b",
      ),
    );
  });

  // Gone is not closed: the pane stays, marked dead, until a person closes it.
  it("marks a removed session dead without dropping its pane", async () => {
    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(onTerminalRemoved).toHaveBeenCalled());
    handlerOf(onTerminalStarted)(terminalSession("t1"));
    await waitFor(() =>
      expect(useSpurStore.getState().terminalSessions["t1"]).toBeDefined(),
    );

    handlerOf(onTerminalRemoved)({ id: "t1" });

    const state = useSpurStore.getState();
    expect("t1" in state.terminalExited).toBe(true);
    expect(state.terminalSessions["t1"]).toBeDefined();
    expect(state.terminalTabs.some((t) => t.id === "t1")).toBe(true);
  });

  // `exited` arrives before `removed`, and the exit code is the better answer.
  it("keeps a real exit code when the removal follows the exit", async () => {
    renderHook(() => useTerminalEvents());
    await waitFor(() => expect(onTerminalExited).toHaveBeenCalled());
    handlerOf(onTerminalStarted)(terminalSession("t1"));
    await waitFor(() =>
      expect(useSpurStore.getState().terminalSessions["t1"]).toBeDefined(),
    );

    handlerOf(onTerminalExited)({ id: "t1", exitCode: 1 });
    handlerOf(onTerminalRemoved)({ id: "t1" });

    expect(useSpurStore.getState().terminalExited["t1"]).toBe(1);
  });

  it("does nothing when terminals are unsupported", async () => {
    terminalsAvailable.mockResolvedValue(false);
    useSpurStore.setState({ terminalsSupported: false } as never);

    renderHook(() => useTerminalEvents());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminalList).not.toHaveBeenCalled();
    expect(onTerminalStatusChanged).not.toHaveBeenCalled();
    expect(onTerminalStarted).not.toHaveBeenCalled();
  });
});
