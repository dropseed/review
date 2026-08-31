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

import { useSpurStore } from "../index";

beforeEach(() => {
  generateCommitMessage.mockReset();
  useSpurStore.setState({
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

    await useSpurStore.getState().generateCommitMessage();

    const state = useSpurStore.getState();
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

    await useSpurStore.getState().generateCommitMessage();

    const state = useSpurStore.getState();
    expect(state.commitMessage).toBe("feat: add thing");
    expect(state.commitMessageGenerating).toBe(false);
    expect(state.commitResult).toBeNull();
  });

  it("discards stale content but still clears the generating flag after the repo changed", async () => {
    let resolveGenerate: (value: string) => void;
    generateCommitMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );

    const promise = useSpurStore.getState().generateCommitMessage();
    expect(useSpurStore.getState().commitMessageGenerating).toBe(true);

    // Simulate switching to a different repo while the request is in
    // flight. Nothing is generating there -- the flag must come back down
    // rather than staying stuck true and locking out Generate/Commit.
    useSpurStore.setState({
      repoPath: "/repo-b",
      worktreePath: null,
      commitMessage: "repo b's own draft",
    } as never);

    resolveGenerate!("feat: stale message");
    await promise;

    const state = useSpurStore.getState();
    expect(state.commitMessage).toBe("repo b's own draft");
    expect(state.commitMessageGenerating).toBe(false);
  });

  it("discards a response superseded by a second generate call, and leaves the flag to the newer call", async () => {
    let resolveFirst: (value: string) => void;
    generateCommitMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );

    const firstPromise = useSpurStore.getState().generateCommitMessage();

    generateCommitMessage.mockResolvedValueOnce("feat: second message");
    const secondPromise = useSpurStore.getState().generateCommitMessage();

    resolveFirst!("feat: first, stale message");
    await Promise.all([firstPromise, secondPromise]);

    const state = useSpurStore.getState();
    expect(state.commitMessage).toBe("feat: second message");
    expect(state.commitMessageGenerating).toBe(false);
  });

  it("clears the generating flag immediately on setRepoPath, not only once the stale request settles", async () => {
    let resolveGenerate: (value: string) => void;
    generateCommitMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );

    const promise = useSpurStore.getState().generateCommitMessage();
    expect(useSpurStore.getState().commitMessageGenerating).toBe(true);

    // The real repo-switch path (not a raw setState): the commit box must
    // reset the instant the working tree changes, not several seconds
    // later when the abandoned LLM call happens to settle -- otherwise
    // the newly focused repo's Generate/Commit buttons stay disabled for
    // however long that takes.
    useSpurStore.getState().setRepoPath("/repo-b");
    expect(useSpurStore.getState().commitMessageGenerating).toBe(false);
    expect(useSpurStore.getState().commitMessage).toBe("");

    resolveGenerate!("feat: stale message");
    await promise;

    const state = useSpurStore.getState();
    expect(state.commitMessage).toBe("");
    expect(state.commitMessageGenerating).toBe(false);
  });

  it("isn't marked stale by an unrelated commitStaged call", async () => {
    let resolveGenerate: (value: string) => void;
    generateCommitMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );

    const promise = useSpurStore.getState().generateCommitMessage();

    // A genuine, unrelated commit -- its own request, its own nonce --
    // must not mark this generation as superseded.
    useSpurStore.setState({
      commitMessage: "unrelated staged commit",
    } as never);
    await useSpurStore.getState().commitStaged();

    resolveGenerate!("feat: add thing");
    await promise;

    const state = useSpurStore.getState();
    expect(state.commitMessage).toBe("feat: add thing");
    expect(state.commitMessageGenerating).toBe(false);
  });
});
