import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

// The viewers are screens of their own; what's under test is which of them the
// content area picks, and what it shows when it picks none.
vi.mock("../FileViewer", () => ({ FileViewer: () => <div>a file</div> }));
vi.mock("./MultiFileDiffViewer", () => ({
  MultiFileDiffViewer: ({ group }: { group?: { hunkIds: string[] } }) => (
    <div>{`rolling diff of ${group?.hunkIds.length ?? "store group"}`}</div>
  ),
}));

import { ContentArea } from "./index";
import { useSpurStore } from "../../stores";
import { makeComparison } from "../../types";

function hunk(id: string, filePath: string) {
  return {
    id,
    filePath,
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1,
    lines: [],
  };
}

function seed(extra: object = {}) {
  useSpurStore.setState({
    repoPath: "/repo",
    comparison: makeComparison("main", "feature"),
    selectedFile: null,
    secondaryFile: null,
    externalFilePath: null,
    guideContentMode: null,
    workingTreeMultiView: null,
    searchViewOpen: false,
    reviewState: null,
    loadingProgress: null,
    filesByPath: {},
    flatFileList: [],
    ...extra,
  } as never);
}

/** A loaded review with two files, one pending hunk each. */
function seedLoadedReview(extra: object = {}) {
  seed({
    reviewState: { hunks: {}, trustList: [] },
    filesByPath: {
      "a.ts": { hunks: [hunk("a.ts:1", "a.ts")] },
      "b.ts": { hunks: [hunk("b.ts:2", "b.ts")] },
    },
    flatFileList: ["a.ts", "b.ts"],
    ...extra,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the content area with nothing open", () => {
  /**
   * Before a review is loaded (browse mode, no review state) there is no
   * default to show. This state used to be a second screen restating the
   * files column — it says one thing now.
   */
  it("asks for a file, and reports nothing else", () => {
    seed();
    render(<ContentArea />);

    expect(screen.getByText("Select a file to review.")).toBeDefined();
    expect(screen.queryByText(/reviewed/)).toBeNull();
    expect(screen.queryByText(/hunks/)).toBeNull();
  });

  it("defaults to the needs-review rolling diff once the review is loaded", async () => {
    seedLoadedReview();
    render(<ContentArea />);

    expect(await screen.findByText("rolling diff of 2")).toBeDefined();
    expect(screen.queryByText("Select a file to review.")).toBeNull();
  });

  it("does not mount the rolling diff into a narrow (hidden) code half", () => {
    seedLoadedReview();
    render(<ContentArea narrow />);

    expect(screen.getByText("Select a file to review.")).toBeDefined();
  });

  it("asks for a file when nothing needs review", () => {
    seedLoadedReview({
      reviewState: {
        hunks: {
          "a.ts:1": { status: { value: "approved" } },
          "b.ts:2": { status: { value: "approved" } },
        },
        trustList: [],
      },
    });
    render(<ContentArea />);

    expect(screen.getByText("Select a file to review.")).toBeDefined();
  });

  it("says a comparison is still loading rather than asking for a file", () => {
    seedLoadedReview({
      loadingProgress: { phase: "hunks", current: 0, total: 1 },
    });
    render(<ContentArea />);

    expect(screen.getByText("Loading feature…")).toBeDefined();
    expect(screen.queryByText("Select a file to review.")).toBeNull();
  });

  it("shows the file once there is one", () => {
    seed({ selectedFile: "a.ts" });
    render(<ContentArea />);

    expect(screen.getByText("a file")).toBeDefined();
    expect(screen.queryByText("Select a file to review.")).toBeNull();
  });
});
