import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";

// Hoisted: `vi.mock` runs before module-level consts.
const { listWorkspaces, onWorkChanged } = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  onWorkChanged: vi.fn(() => () => undefined),
}));

// Same stubbing as the other store-backed hook tests: the store wires a real
// backend client at module load.
vi.mock("../api", () => ({
  getApiClient: () => ({ listWorkspaces, onWorkChanged }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useSpurStore } from "../stores";
import { useWorkspaceSync } from "./useWorkspaceSync";
import { workspace as makeWorkspace } from "../test/fixtures";

function item(id: string) {
  return makeWorkspace(id, { title: id });
}

beforeEach(() => {
  listWorkspaces.mockReset();
  useSpurStore.setState({ workspaces: [] });
});

afterEach(() => cleanup());

describe("useWorkspaceSync", () => {
  it("loads the queue on mount", async () => {
    listWorkspaces.mockResolvedValue([item("a")]);

    renderHook(() => useWorkspaceSync());

    await waitFor(() =>
      expect(useSpurStore.getState().workspaces).toEqual([item("a")]),
    );
  });

  it("leaves the list alone when a read fails", async () => {
    useSpurStore.setState({ workspaces: [item("a")] });
    listWorkspaces.mockRejectedValue(new Error("backend not ready"));

    renderHook(() => useWorkspaceSync());

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
    // A failed read is not evidence of an empty queue — the `spur` CLI is
    // writing the same file, and the app must not blank the list on a blip.
    expect(useSpurStore.getState().workspaces).toEqual([item("a")]);
  });

  it("re-reads on focus, so a queue the CLI changed catches up", async () => {
    listWorkspaces.mockResolvedValue([]);
    renderHook(() => useWorkspaceSync());
    await waitFor(() => expect(listWorkspaces).toHaveBeenCalledTimes(1));

    listWorkspaces.mockResolvedValue([item("a")]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(useSpurStore.getState().workspaces).toEqual([item("a")]),
    );
  });
});
