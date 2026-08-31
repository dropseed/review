import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => Promise.resolve([]) }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

// The rows themselves are their own screens, and they read a context this
// component's caller provides — stubbed so what's under test is which group
// headers get rendered at all.
vi.mock("./FileListSection", () => ({
  FileListSection: () => null,
  CHECK_ICON: null,
}));
vi.mock("../GuideView/TrustSection", () => ({ TrustSection: () => null }));
vi.mock("./FilenameModal", () => ({ FilenameModal: () => null }));

import { StatusGroupList } from "./StatusGroupList";
import type { StatusGroupListProps } from "./StatusGroupList";
import { TooltipProvider } from "../ui/tooltip";
import { FilesPanelProvider } from "./FilesPanelContext";
import { useSpurStore } from "../../stores";
import { makeComparison } from "../../types";
import type { DiffHunk } from "../../types";
import type { ProcessedFileEntry } from "./types";

const FILE = "a.ts";

function hunk(index: number): DiffHunk {
  return {
    id: `${FILE}:h${index}`,
    filePath: FILE,
    oldStart: index,
    oldCount: 1,
    newStart: index,
    newCount: 1,
    content: "",
    lines: [],
    contentHash: `h${index}`,
  };
}

const HUNKS = [hunk(0), hunk(1), hunk(2)];

const entry = {
  name: FILE,
  path: FILE,
  isDirectory: false,
  status: "modified",
  matchesFilter: true,
  compactedPaths: [],
} as unknown as ProcessedFileEntry;

/** A comparison of three changed hunks with no review state — a peek. */
function seed(): void {
  useSpurStore.setState({
    repoPath: "/repo",
    comparison: makeComparison("main", "feature"),
    files: [entry],
    filesByPath: { [FILE]: { hunks: HUNKS, contentHash: "abc" } },
    flatFileList: [FILE],
    reviewState: null,
    scope: null,
    stagedFilePaths: new Set<string>(),
    changesDisplayMode: "tree",
  } as never);
}

function props(over: Partial<StatusGroupListProps> = {}): StatusGroupListProps {
  return {
    sectionedFiles: {
      needsReview: [entry],
      savedForLater: [],
      reviewed: [],
      trusted: [],
    },
    flatSectionedFiles: {
      needsReview: [FILE],
      savedForLater: [],
      reviewed: [],
      trusted: [],
    },
    stats: {
      pending: 3,
      approved: 0,
      trusted: 0,
      total: 3,
      rejected: 0,
      savedForLater: 0,
      needsReviewFiles: 1,
      reviewedFiles: 0,
    },
    renamedDirPaths: new Set<string>(),
    hunks: HUNKS,
    reviewState: null,
    expandAll: () => {},
    collapseAll: () => {},
    needsReviewOpen: true,
    setNeedsReviewOpen: () => {},
    savedForLaterOpen: true,
    setSavedForLaterOpen: () => {},
    reviewedOpen: true,
    setReviewedOpen: () => {},
    trustOpen: false,
    setTrustOpen: () => {},
    ...over,
  };
}

function draw(over: Partial<StatusGroupListProps> = {}): void {
  render(
    <TooltipProvider>
      <FilesPanelProvider value={{ handleSelectFile: () => {} } as never}>
        <StatusGroupList {...props(over)} />
      </FilesPanelProvider>
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  useSpurStore.setState({
    repoPath: null,
    comparison: null,
    files: [],
    filesByPath: {},
    flatFileList: [],
    reviewState: null,
  } as never);
});

describe("the status groups", () => {
  it("are what a review's queue is drawn as", () => {
    seed();
    draw();

    expect(screen.getByText("Needs Review")).toBeDefined();
    expect(screen.getByText("Reviewed")).toBeDefined();
  });

  /**
   * A commit being looked at has no review — no decisions recorded and none
   * that can be made — so "Reviewed 0 · No files reviewed yet" was the screen
   * promising something it cannot keep, over a diff nothing can be approved
   * in. One list of what changed says the true thing instead.
   */
  it("collapse to one list of what changed when there is no review", () => {
    seed();
    draw({ changedOnly: true });

    expect(screen.getByText("Changed · 3")).toBeDefined();
    expect(screen.queryByText("Needs Review")).toBeNull();
    expect(screen.queryByText("Reviewed")).toBeNull();
    expect(screen.queryByText("Trusted")).toBeNull();
  });

  it("offer no decision to make while collapsed", () => {
    seed();
    draw({ changedOnly: true });

    // The hover verb that approves a whole section at once, and the header's
    // own count pill — both belong to a queue, and this is not one.
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
  });
});
