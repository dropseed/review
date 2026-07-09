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
    comparison: { base: "main", head: "HEAD", key: "main..HEAD" },
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
  it("stays hidden when no hunk carries a risk", () => {
    seed({ "a:1": {} });
    const { container } = render(<ReviewFilterBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the toggles once a hunk is risk-tagged", () => {
    seed({ "a:1": { risk: attributed("high", "agent") } });
    render(<ReviewFilterBar />);
    expect(screen.getByText("All")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Low")).toBeTruthy();
  });

  it("toggles the risk filter on and off", () => {
    seed({ "a:1": { risk: attributed("high", "agent") } });
    render(<ReviewFilterBar />);

    fireEvent.click(screen.getByText("High"));
    expect(useReviewStore.getState().reviewFilter.risk).toEqual(["high"]);

    // Clicking the active toggle clears it.
    fireEvent.click(screen.getByText("High"));
    expect(useReviewStore.getState().reviewFilter.risk).toBeUndefined();
  });

  it("switching to Low replaces the active risk", () => {
    seed({ "a:1": { risk: attributed("high", "agent") } });
    render(<ReviewFilterBar />);
    fireEvent.click(screen.getByText("High"));
    fireEvent.click(screen.getByText("Low"));
    expect(useReviewStore.getState().reviewFilter.risk).toEqual(["low"]);
  });

  it("acts on exactly the matching set", () => {
    seed({
      "a.ts:1": { risk: attributed("low", "agent") },
      "a.ts:2": { risk: attributed("high", "agent") },
    });
    render(<ReviewFilterBar />);

    // No action row until a filter is active.
    expect(screen.queryByTestId("review-filter-actions")).toBeNull();

    fireEvent.click(screen.getByText("High"));
    expect(screen.getByText("1 matching")).toBeTruthy();

    fireEvent.click(screen.getByText("Approve"));
    const hunks = useReviewStore.getState().reviewState!.hunks;
    expect(hunks["a.ts:2"].status?.value).toBe("approved"); // high → approved
    expect(hunks["a.ts:1"].status?.value).toBeUndefined(); // low → untouched
  });
});
