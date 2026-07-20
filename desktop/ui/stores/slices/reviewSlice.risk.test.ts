import { vi, describe, it, expect, beforeEach } from "vitest";

// Sounds touch the Audio API, which jsdom doesn't implement — stub them.
vi.mock("../../utils/sounds", () => ({
  playApproveSound: () => {},
  playRejectSound: () => {},
  playBulkSound: () => {},
}));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform — these tests drive
// pure store logic with no repo, so saves no-op.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../index";
import { attributed, type FileDiff, type ReviewState } from "../../types";

function baseReviewState(): ReviewState {
  return {
    ref: "HEAD",
    hunks: {
      "a.ts:1": { risk: attributed("low", "agent") },
      "a.ts:2": { risk: attributed("high", "agent") },
      "a.ts:3": {},
    },
    trustList: [],
    notes: "",
    annotations: [],
    createdAt: "t",
    updatedAt: "t",
    version: 0,
    totalDiffHunks: 3,
  };
}

beforeEach(() => {
  const filesByPath: Record<string, FileDiff> = {
    "a.ts": {
      hunks: [
        { id: "a.ts:1", filePath: "a.ts" },
        { id: "a.ts:2", filePath: "a.ts" },
        { id: "a.ts:3", filePath: "a.ts" },
      ],
    } as unknown as FileDiff,
  };
  useReviewStore.setState({
    reviewState: baseReviewState(),
    filesByPath,
    flatFileList: ["a.ts"],
    // Null repo/comparison makes the debounced save a no-op (no backend call).
    repoPath: null,
    comparison: null,
    readOnlyPreview: false,
    reviewFilter: {},
  } as never);
});

describe("risk store actions", () => {
  it("setHunkRisk records the level with a ui source", () => {
    useReviewStore.getState().setHunkRisk("a.ts:3", "high");
    expect(useReviewStore.getState().reviewState!.hunks["a.ts:3"].risk).toEqual(
      {
        value: "high",
        source: "ui",
      },
    );
  });

  it("clearHunkRisk removes the risk", () => {
    useReviewStore.getState().clearHunkRisk("a.ts:1");
    expect(
      useReviewStore.getState().reviewState!.hunks["a.ts:1"].risk,
    ).toBeUndefined();
  });

  it("setRiskForHunks sets risk on many hunks at once", () => {
    useReviewStore.getState().setRiskForHunks(["a.ts:3", "a.ts:1"], "high");
    const hunks = useReviewStore.getState().reviewState!.hunks;
    expect(hunks["a.ts:3"].risk).toEqual({ value: "high", source: "ui" });
    expect(hunks["a.ts:1"].risk).toEqual({ value: "high", source: "ui" });
  });

  it("setRiskForHunks with null clears risk on the set", () => {
    useReviewStore.getState().setRiskForHunks(["a.ts:1", "a.ts:2"], null);
    const hunks = useReviewStore.getState().reviewState!.hunks;
    expect(hunks["a.ts:1"].risk).toBeUndefined();
    expect(hunks["a.ts:2"].risk).toBeUndefined();
  });
});
