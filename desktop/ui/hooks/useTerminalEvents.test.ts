import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

const { terminalList, onTerminalStatusChanged, terminalsAvailable } =
  vi.hoisted(() => ({
    terminalList: vi.fn(),
    onTerminalStatusChanged: vi.fn(),
    terminalsAvailable: vi.fn(),
  }));

vi.mock("../api", () => ({
  getApiClient: () => ({
    terminalList,
    onTerminalStatusChanged,
    terminalsAvailable,
    terminalReplay: () => Promise.resolve({ data: "", status: null }),
    onTerminalOutput: () => () => undefined,
    onTerminalExit: () => () => undefined,
    onTerminalStatus: () => () => undefined,
  }),
  isTauriEnvironment: () => false,
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../stores";
import { useTerminalEvents } from "./useTerminalEvents";

beforeEach(() => {
  terminalList.mockReset().mockResolvedValue([]);
  onTerminalStatusChanged.mockReset().mockReturnValue(() => undefined);
  terminalsAvailable.mockReset().mockResolvedValue(true);
  useReviewStore.setState({
    repoPath: null,
    reviewRef: null,
    terminalsSupported: true,
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
  });

  it("does nothing when terminals are unsupported", async () => {
    terminalsAvailable.mockResolvedValue(false);
    useReviewStore.setState({ terminalsSupported: false } as never);

    renderHook(() => useTerminalEvents());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminalList).not.toHaveBeenCalled();
    expect(onTerminalStatusChanged).not.toHaveBeenCalled();
  });
});
