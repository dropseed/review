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

import { ContentArea } from "./index";
import { useReviewStore } from "../../stores";
import { makeComparison } from "../../types";

function seed(extra: object = {}) {
  useReviewStore.setState({
    repoPath: "/repo",
    comparison: makeComparison("main", "feature"),
    selectedFile: null,
    secondaryFile: null,
    externalFilePath: null,
    guideContentMode: null,
    workingTreeMultiView: null,
    searchViewOpen: false,
    ...extra,
  } as never);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the content area with nothing open", () => {
  /**
   * This state used to be a second screen restating the files column — a
   * progress header, a file tree with per-file fractions, a symbol listing. It
   * says one thing now.
   */
  it("asks for a file, and reports nothing else", () => {
    seed();
    render(<ContentArea />);

    expect(screen.getByText("Select a file to review.")).toBeDefined();
    expect(screen.queryByText(/reviewed/)).toBeNull();
    expect(screen.queryByText(/hunks/)).toBeNull();
  });

  it("shows the file once there is one", () => {
    seed({ selectedFile: "a.ts" });
    render(<ContentArea />);

    expect(screen.getByText("a file")).toBeDefined();
    expect(screen.queryByText("Select a file to review.")).toBeNull();
  });
});
