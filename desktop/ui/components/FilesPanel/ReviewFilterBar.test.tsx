import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Sounds touch the Audio API, which jsdom doesn't implement — stub them.
vi.mock("../../utils/sounds", () => ({
  playApproveSound: () => {},
  playRejectSound: () => {},
  playBulkSound: () => {},
}));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform for the render test.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../../stores";
import { attributed, type HunkState, type ReviewState } from "../../types";
import { ReviewFilterBar } from "./ReviewFilterBar";

function reviewStateWith(hunks: Record<string, HunkState>): ReviewState {
  return {
    ref: "HEAD",
    hunks,
    trustList: [],
    notes: "",
    annotations: [],
    createdAt: "t",
    updatedAt: "t",
    version: 0,
    totalDiffHunks: Object.keys(hunks).length,
  };
}

function seed(hunks: Record<string, HunkState>) {
  // Mirror the hunks into filesByPath so useAllHunks (which the action row
  // reads) returns them. File path is the segment before the ":" in the id.
  const byFile: Record<string, { hunks: { id: string; filePath: string }[] }> =
    {};
  for (const id of Object.keys(hunks)) {
    const filePath = id.split(":")[0] || id;
    (byFile[filePath] ??= { hunks: [] }).hunks.push({ id, filePath });
  }
  useReviewStore.setState({
    reviewState: reviewStateWith(hunks),
    filesByPath: byFile,
    flatFileList: Object.keys(byFile),
    readOnlyPreview: false,
    repoPath: null,
    comparison: null,
    reviewFilter: {},
  } as never);
}

beforeEach(() => {
  useReviewStore.setState({ reviewFilter: {} } as never);
});
afterEach(() => cleanup());

describe("ReviewFilterBar", () => {
  it("stays hidden with no active filter or scope", () => {
    seed({ "a:1": {} });
    const { container } = render(<ReviewFilterBar />);
    expect(container.firstChild).toBeNull();
  });

  it("acts on exactly the matching set", () => {
    seed({
      "a.ts:1": { status: attributed("rejected", "ui") },
      "a.ts:2": {},
    });
    useReviewStore.setState({
      reviewFilter: { status: ["unreviewed"] },
    } as never);
    render(<ReviewFilterBar />);
    expect(screen.getByText("1 matching")).toBeTruthy();

    fireEvent.click(screen.getByText("Approve"));
    const hunks = useReviewStore.getState().reviewState!.hunks;
    expect(hunks["a.ts:2"].status?.value).toBe("approved"); // unreviewed → approved
    expect(hunks["a.ts:1"].status?.value).toBe("rejected"); // untouched
  });
});
