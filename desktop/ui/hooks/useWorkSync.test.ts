import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";

// Hoisted: `vi.mock` runs before module-level consts.
const { listWorkItems } = vi.hoisted(() => ({ listWorkItems: vi.fn() }));

// Same stubbing as the other store-backed hook tests: the store wires a real
// backend client at module load.
vi.mock("../api", () => ({
  getApiClient: () => ({
    listWorkItems,
    onWorkChanged: () => () => undefined,
  }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../stores";
import { useWorkSync } from "./useWorkSync";

const migrate = vi.fn();

function item(id: string) {
  return { id, title: id, refs: [], createdAt: "2026-01-01T00:00:00Z" };
}

beforeEach(() => {
  listWorkItems.mockReset();
  migrate.mockReset();
  useReviewStore.setState({
    workItems: [],
    migrateTerminalAttachments: migrate,
  } as never);
});

afterEach(() => cleanup());

describe("useWorkSync", () => {
  it("migrates once the list has actually loaded", async () => {
    listWorkItems.mockResolvedValue([item("a")]);

    renderHook(() => useWorkSync());

    await waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    expect(migrate).toHaveBeenCalledWith([item("a")]);
  });

  // The migration drops every attachment naming an item the list doesn't
  // hold, and persists that. Run against a list that failed to load, it wipes
  // the lot — so a failure must not arm it.
  it("never migrates when the initial load fails", async () => {
    listWorkItems.mockRejectedValue(new Error("backend not ready"));

    renderHook(() => useWorkSync());

    await waitFor(() => expect(listWorkItems).toHaveBeenCalled());
    // Nothing else is pending, so a few macrotasks is the whole window in
    // which the buggy version would have fired.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(migrate).not.toHaveBeenCalled();
  });

  it("arms the migration on a later successful refresh", async () => {
    listWorkItems.mockRejectedValueOnce(new Error("backend not ready"));
    renderHook(() => useWorkSync());

    await waitFor(() => expect(listWorkItems).toHaveBeenCalled());
    expect(migrate).not.toHaveBeenCalled();

    // A refresh that lands is what recovers the session — here the focus
    // refresh, but the watcher event and the poll go through the same path.
    listWorkItems.mockResolvedValue([item("a")]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(migrate).toHaveBeenCalledWith([item("a")]));
    expect(migrate).toHaveBeenCalledTimes(1);
  });
});
