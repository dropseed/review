import { vi, describe, it, expect, beforeEach } from "vitest";

// Sounds touch the Audio API, which jsdom doesn't implement — stub them.
vi.mock("../../utils/sounds", () => ({
  playApproveSound: () => {},
  playRejectSound: () => {},
  playBulkSound: () => {},
}));

const { generateCommitMessage } = vi.hoisted(() => ({
  generateCommitMessage: vi.fn(),
}));

// The store wires a real backend client at module load (which trips on HMR
// internals under vitest). Stub the backend + platform — these tests drive
// pure store logic, and only the commit-message generation call is asserted.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy(
      { generateCommitMessage },
      { get: (target, prop) => target[prop as never] ?? (() => () => {}) },
    ),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../index";

beforeEach(() => {
  generateCommitMessage.mockReset();
  useReviewStore.setState({
    repoPath: "/repo",
    worktreePath: null,
    commitMessage: "my in-progress draft",
    commitMessageGenerating: false,
    commitResult: null,
  } as never);
});

describe("generateCommitMessage", () => {
  it("restores the prior draft and surfaces an error on failure", async () => {
    generateCommitMessage.mockRejectedValue(new Error("claude not found"));

    await useReviewStore.getState().generateCommitMessage();

    const state = useReviewStore.getState();
    expect(state.commitMessage).toBe("my in-progress draft");
    expect(state.commitMessageGenerating).toBe(false);
    expect(state.commitResult).toEqual({
      success: false,
      commitHash: null,
      summary: "Failed to generate commit message: Error: claude not found",
    });
  });

  it("replaces the draft with the generated message on success", async () => {
    generateCommitMessage.mockResolvedValue("feat: add thing");

    await useReviewStore.getState().generateCommitMessage();

    const state = useReviewStore.getState();
    expect(state.commitMessage).toBe("feat: add thing");
    expect(state.commitMessageGenerating).toBe(false);
    expect(state.commitResult).toBeNull();
  });
});
