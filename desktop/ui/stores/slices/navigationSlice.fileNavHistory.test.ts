import { vi, describe, it, expect, beforeEach } from "vitest";

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

beforeEach(() => {
  useReviewStore.setState({
    fileNavHistory: [],
    fileNavIndex: -1,
    selectedFile: null,
    filesByPath: {},
    repoPath: null,
    comparison: null,
  });
});

describe("recordFileVisit", () => {
  it("appends visited files and advances the cursor", () => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("b.ts");
    const { fileNavHistory, fileNavIndex } = useReviewStore.getState();
    expect(fileNavHistory).toEqual(["a.ts", "b.ts"]);
    expect(fileNavIndex).toBe(1);
  });

  it("dedupes re-recording the current entry", () => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("a.ts");
    const { fileNavHistory, fileNavIndex } = useReviewStore.getState();
    expect(fileNavHistory).toEqual(["a.ts"]);
    expect(fileNavIndex).toBe(0);
  });

  it("drops forward history when visiting a new file after going back", () => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("b.ts");
    useReviewStore.getState().recordFileVisit("c.ts");
    useReviewStore.setState({ fileNavIndex: 0 }); // simulate having stepped back to a.ts
    useReviewStore.getState().recordFileVisit("d.ts");
    const { fileNavHistory, fileNavIndex } = useReviewStore.getState();
    expect(fileNavHistory).toEqual(["a.ts", "d.ts"]);
    expect(fileNavIndex).toBe(1);
  });

  it("caps the stack at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      useReviewStore.getState().recordFileVisit(`file${i}.ts`);
    }
    const { fileNavHistory, fileNavIndex } = useReviewStore.getState();
    expect(fileNavHistory).toHaveLength(50);
    expect(fileNavHistory[0]).toBe("file10.ts");
    expect(fileNavHistory[49]).toBe("file59.ts");
    expect(fileNavIndex).toBe(49);
  });
});

describe("navigateFileHistory", () => {
  beforeEach(() => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("b.ts");
    useReviewStore.getState().recordFileVisit("c.ts");
  });

  it("steps back and selects the previous file", () => {
    useReviewStore.getState().navigateFileHistory(-1);
    const state = useReviewStore.getState();
    expect(state.fileNavIndex).toBe(1);
    expect(state.selectedFile).toBe("b.ts");
  });

  it("is a no-op past the start of history", () => {
    useReviewStore.getState().navigateFileHistory(-1);
    useReviewStore.getState().navigateFileHistory(-1);
    useReviewStore.getState().navigateFileHistory(-1); // already at index 0
    const state = useReviewStore.getState();
    expect(state.fileNavIndex).toBe(0);
    expect(state.selectedFile).toBe("a.ts");
  });

  it("is a no-op past the end of history", () => {
    useReviewStore.getState().navigateFileHistory(-1); // b.ts, so forward has somewhere to go
    useReviewStore.getState().navigateFileHistory(1); // c.ts, back at the most recent entry
    useReviewStore.getState().navigateFileHistory(1); // already at the most recent entry
    const state = useReviewStore.getState();
    expect(state.fileNavIndex).toBe(2);
    expect(state.selectedFile).toBe("c.ts");
  });

  it("does not re-record the target file it navigates to", () => {
    useReviewStore.getState().navigateFileHistory(-1);
    // Simulate useMouseNavigation's effect reacting to the new selectedFile.
    useReviewStore
      .getState()
      .recordFileVisit(useReviewStore.getState().selectedFile!);
    const { fileNavHistory, fileNavIndex } = useReviewStore.getState();
    expect(fileNavHistory).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(fileNavIndex).toBe(1);
  });
});
