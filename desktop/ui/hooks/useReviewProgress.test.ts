import { vi, describe, it, expect } from "vitest";

// useReviewProgress.ts imports the store, which wires a real backend client at
// module load (tripping on HMR internals under vitest). Stub backend+platform;
// computeReviewProgress itself is pure.
vi.mock("../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { computeReviewProgress } from "./useReviewProgress";
import { attributed, type DiffHunk, type ReviewState } from "../types";

function hunks(ids: string[]): DiffHunk[] {
  return ids.map((id) => ({ id, filePath: id.split(":")[0] })) as DiffHunk[];
}

describe("computeReviewProgress — high-risk pending", () => {
  it("counts high-risk hunks awaiting an explicit decision", () => {
    const rs = {
      trustList: ["imports:*"],
      hunks: {
        "a:1": { risk: attributed("high", "agent") }, // pending high-risk
        "a:2": {
          risk: attributed("high", "agent"),
          status: attributed("approved", "ui"),
        }, // decided → not pending
        "a:3": { risk: attributed("low", "agent") }, // low → not counted
        "a:4": {
          classification: attributed(["imports:added"], "static"),
          risk: attributed("high", "agent"),
        }, // trusted label BUT high-risk → veto keeps it pending
      },
    } as unknown as ReviewState;

    const p = computeReviewProgress(hunks(["a:1", "a:2", "a:3", "a:4"]), rs);
    expect(p.highRiskPendingHunks).toBe(2); // a:1 and a:4
    // a:4's trusted label is vetoed by high risk — not counted as trusted.
    expect(p.trustedHunks).toBe(0);
    expect(p.approvedHunks).toBe(1); // a:2
  });

  it("is zero when nothing is high-risk", () => {
    const rs = {
      trustList: [],
      hunks: { "a:1": {} },
    } as unknown as ReviewState;
    expect(computeReviewProgress(hunks(["a:1"]), rs).highRiskPendingHunks).toBe(
      0,
    );
  });
});
