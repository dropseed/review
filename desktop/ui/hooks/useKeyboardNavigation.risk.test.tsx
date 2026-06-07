import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

vi.mock("../utils/sounds", () => ({
  playApproveSound: () => {},
  playRejectSound: () => {},
  playBulkSound: () => {},
}));
vi.mock("../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../stores";
import { useKeyboardNavigation } from "./useKeyboardNavigation";
import type { FileDiff, ReviewState } from "../types";

function seed() {
  const reviewState: ReviewState = {
    comparison: { base: "main", head: "HEAD", key: "main..HEAD" },
    hunks: { "a.ts:1": {} },
    trustList: [],
    notes: "",
    annotations: [],
    createdAt: "t",
    updatedAt: "t",
    version: 0,
    totalDiffHunks: 1,
  };
  useReviewStore.setState({
    reviewState,
    filesByPath: {
      "a.ts": {
        hunks: [{ id: "a.ts:1", filePath: "a.ts" }],
      } as unknown as FileDiff,
    },
    flatFileList: ["a.ts"],
    focusedHunkId: "a.ts:1",
    repoPath: null,
    comparison: null,
    readOnlyPreview: false,
  } as never);
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

beforeEach(() => seed());
afterEach(() => cleanup());

describe("useKeyboardNavigation — risk shortcuts", () => {
  it("Shift+H flags the focused hunk high; pressing again clears it", () => {
    renderHook(() => useKeyboardNavigation());
    press("H");
    expect(useReviewStore.getState().reviewState!.hunks["a.ts:1"].risk).toEqual(
      { value: "high", source: "ui" },
    );
    press("H");
    expect(
      useReviewStore.getState().reviewState!.hunks["a.ts:1"].risk,
    ).toBeUndefined();
  });

  it("Shift+L flags low; Shift+H then replaces it with high", () => {
    renderHook(() => useKeyboardNavigation());
    press("L");
    expect(
      useReviewStore.getState().reviewState!.hunks["a.ts:1"].risk?.value,
    ).toBe("low");
    press("H");
    expect(
      useReviewStore.getState().reviewState!.hunks["a.ts:1"].risk?.value,
    ).toBe("high");
  });
});
