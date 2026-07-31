import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { DiffHunk, HunkStatusValue, ReviewState } from "../../types";
import { makeComparison } from "../../types";

// The store wires a real backend client at module load; these tests drive the
// panel's own rendering, not the backend.
vi.mock("../../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

// The panel's sections and docks are screens of their own — stubbed so what's
// under test is the tab strip above them.
vi.mock("./StatusGroupList", () => ({ StatusGroupList: () => null }));
vi.mock("./GuideBanner", () => ({ GuideBanner: () => null }));
vi.mock("./GuideModePanel", () => ({ GuideModePanel: () => null }));
vi.mock("./CommitRangePicker", () => ({ CommitRangePicker: () => null }));
vi.mock("./CommitRangeHeader", () => ({ CommitRangeHeader: () => null }));
vi.mock("./AnnotationDock", () => ({ AnnotationDock: () => null }));
vi.mock("./ReviewActionBar", () => ({ ReviewActionBar: () => null }));
vi.mock("./SearchResultsPanel", () => ({ SearchResultsPanel: () => null }));
vi.mock("./GitStatusPanel", () => ({ GitStatusPanel: () => null }));

import { FilesPanel } from "./index";
import { TooltipProvider } from "../ui/tooltip";
import { useReviewStore } from "../../stores";

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

const HUNKS = Array.from({ length: 10 }, (_, i) => hunk(i));

function reviewState(
  statuses: Record<string, HunkStatusValue>,
  extra: Partial<ReviewState> = {},
): ReviewState {
  return {
    ref: "feature",
    hunks: Object.fromEntries(
      Object.entries(statuses).map(([id, value]) => [
        id,
        { status: { value, source: "ui" as const } },
      ]),
    ),
    trustList: [],
    notes: "",
    annotations: [],
    createdAt: "",
    updatedAt: "",
    version: 1,
    totalDiffHunks: HUNKS.length,
    ...extra,
  };
}

function seedStore(state: Partial<ReviewState> | null, extra: object = {}) {
  useReviewStore.setState({
    repoPath: "/repo",
    comparison: makeComparison("main", "feature"),
    allFiles: [
      { name: FILE, path: FILE, isDirectory: false, status: "modified" },
    ],
    allFilesLoading: false,
    filesByPath: { [FILE]: { hunks: HUNKS, contentHash: "abc" } },
    flatFileList: [FILE],
    reviewState: state,
    scope: null,
    stagedFilePaths: new Set<string>(),
    gitStatus: null,
    guideMode: false,
    guideContentMode: null,
    workingTreeMultiView: null,
    selectedFile: null,
    secondaryFile: null,
    focusedPane: "primary",
    searchResults: [],
    symbolDiffs: [],
    ...extra,
  } as never);
}

/** The Review tab's rendered label, badge included ("Review3", "Review"). */
function reviewTabText(): string {
  return screen.getByRole("tab", { name: /Review/ }).textContent ?? "";
}

function hasCheck(): boolean {
  return (
    screen.getByRole("tab", { name: /Review/ }).querySelector("svg") !== null
  );
}

beforeEach(() => {
  cleanup();
});

describe("FilesPanel review tab badge", () => {
  it("counts hunks saved for later as still waiting", () => {
    const statuses: Record<string, HunkStatusValue> = {};
    for (const h of HUNKS.slice(0, 9)) statuses[h.id] = "approved";
    statuses[HUNKS[9].id] = "saved_for_later";
    seedStore(reviewState(statuses));

    render(
      <TooltipProvider>
        <FilesPanel />
      </TooltipProvider>,
    );

    // A deferral is not a decision — the panel keeps a "Saved for later"
    // section for it, so the tab above cannot claim the review is done.
    expect(reviewTabText()).toBe("Review1");
    expect(hasCheck()).toBe(false);
  });

  it("checks off only once nothing is unresolved", () => {
    const statuses: Record<string, HunkStatusValue> = {};
    for (const h of HUNKS) statuses[h.id] = "approved";
    seedStore(reviewState(statuses));

    render(
      <TooltipProvider>
        <FilesPanel />
      </TooltipProvider>,
    );

    expect(reviewTabText()).toBe("Review");
    expect(hasCheck()).toBe(true);
  });

  it("agrees with the sections when auto-approve-staged is on", () => {
    // The sections count staged files as trusted; a badge counting from the
    // raw store instead would read 10 over a panel reading 0.
    seedStore(reviewState({}, { autoApproveStaged: true }), {
      stagedFilePaths: new Set([FILE]),
    });

    render(
      <TooltipProvider>
        <FilesPanel />
      </TooltipProvider>,
    );

    expect(reviewTabText()).toBe("Review");
    expect(hasCheck()).toBe(true);
  });

  it("narrows to the active scope, like the sections do", () => {
    seedStore(reviewState({}), {
      scope: {
        source: "guide",
        key: "g1",
        title: "Group 1",
        hunkIds: [HUNKS[0].id, HUNKS[1].id],
      },
    });

    render(
      <TooltipProvider>
        <FilesPanel />
      </TooltipProvider>,
    );

    expect(reviewTabText()).toBe("Review2");
  });
});
