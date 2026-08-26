import { vi, describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

// The store wires a real backend client at module load; stub both, the same
// way the other store-backed hook tests do.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useGitTab } from "./hooks/useFilePanelNavigation";
import { useReviewStore } from "../../stores";
import { makeComparison } from "../../types";

function seed(state: Record<string, unknown>): void {
  useReviewStore.setState({
    gitStatus: null,
    comparison: null,
    isStandaloneFile: false,
    ...state,
  } as never);
}

function reason(): string | undefined {
  return renderHook(() => useGitTab()).result.current.disabledReason;
}

afterEach(() => {
  cleanup();
  seed({});
});

/**
 * Why the Git tab is off is decided here, where the condition is — the tab
 * table only renders the answer. All three readings share one shape (no
 * working tree) and need different words.
 */
describe("why the Git tab is unavailable", () => {
  it("names the head, in the words that are on screen", () => {
    // Nobody calls a PR `refs/review/pr/7` out loud.
    seed({ comparison: makeComparison("main", "refs/review/pr/7") });
    expect(reason()).toBe("#7 isn't checked out");
  });

  /**
   * A folder that is not a repo has nothing to check out, so the branch
   * wording would invite a person to go and do something there is no doing.
   */
  it("says so plainly for a folder that isn't a repo", () => {
    seed({ isStandaloneFile: true, comparison: null });
    expect(reason()).toBe("This folder isn't a git repository");
  });

  /** Standalone wins over the head: a directory has no branches to name. */
  it("prefers the folder reading when both could apply", () => {
    seed({
      isStandaloneFile: true,
      comparison: makeComparison("main", "feature"),
    });
    expect(reason()).toBe("This folder isn't a git repository");
  });

  it("falls back when there is no comparison to name", () => {
    seed({});
    expect(reason()).toBe("Nothing here is checked out");
  });
});
