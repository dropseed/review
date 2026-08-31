import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

// useScopeReconciliation.ts imports the store, which wires a real backend
// client at module load (tripping on HMR internals under vitest). Stub
// backend+platform, same as the other store-backed hook tests.
vi.mock("../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useSpurStore } from "../stores";
import { useScopeReconciliation } from "./useScopeReconciliation";
import type { FileDiff } from "../types";
import type { ReviewScope } from "../types/scope";

function seedHunks(ids: string[]) {
  const byFile: Record<string, FileDiff> = {};
  for (const id of ids) {
    const filePath = id.split(":")[0];
    (byFile[filePath] ??= { hunks: [] } as unknown as FileDiff).hunks.push({
      id,
      filePath,
    } as never);
  }
  useSpurStore.setState({
    filesByPath: byFile,
    flatFileList: Object.keys(byFile),
    repoPath: null,
    comparison: null,
  } as never);
}

function scope(hunkIds: string[]): ReviewScope {
  return { source: "commit", key: "sha1", title: "Add feature", hunkIds };
}

beforeEach(() => {
  useSpurStore.setState({ scope: null } as never);
});
afterEach(() => cleanup());

describe("useScopeReconciliation", () => {
  it("leaves the scope untouched when every hunk id still exists", () => {
    seedHunks(["a.ts:1", "b.ts:2"]);
    const s = scope(["a.ts:1", "b.ts:2"]);
    useSpurStore.setState({ scope: s } as never);

    renderHook(() => useScopeReconciliation());

    expect(useSpurStore.getState().scope).toBe(s);
  });

  it("prunes vanished hunk ids but keeps the scope when some survive", () => {
    seedHunks(["a.ts:1"]); // b.ts:2 vanished (e.g. an amend dropped it)
    useSpurStore.setState({
      scope: scope(["a.ts:1", "b.ts:2"]),
    } as never);

    renderHook(() => useScopeReconciliation());

    const result = useSpurStore.getState().scope;
    expect(result).not.toBeNull();
    expect(result!.hunkIds).toEqual(["a.ts:1"]);
  });

  it("clears the scope once none of its hunk ids survive", () => {
    seedHunks(["c.ts:3"]);
    useSpurStore.setState({
      scope: scope(["a.ts:1", "b.ts:2"]),
    } as never);

    renderHook(() => useScopeReconciliation());

    expect(useSpurStore.getState().scope).toBeNull();
  });

  it("ignores an empty-hunkIds scope (nothing to reconcile)", () => {
    seedHunks(["a.ts:1"]);
    const s = scope([]);
    useSpurStore.setState({ scope: s } as never);

    renderHook(() => useScopeReconciliation());

    expect(useSpurStore.getState().scope).toBe(s);
  });
});
