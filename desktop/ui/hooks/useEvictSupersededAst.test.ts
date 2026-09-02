import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import {
  useEvictSupersededAst,
  diffCacheKey,
  type AstSlots,
} from "./useEvictSupersededAst";

const evictFileFromCache = vi.fn();
const evictDiffFromCache = vi.fn();
let pool: unknown = { evictFileFromCache, evictDiffFromCache };

vi.mock("@pierre/diffs/react", () => ({
  useWorkerPool: () => pool,
}));

const NONE: AstSlots = {};

describe("useEvictSupersededAst", () => {
  beforeEach(() => {
    pool = { evictFileFromCache, evictDiffFromCache };
    evictFileFromCache.mockClear();
    evictDiffFromCache.mockClear();
  });

  afterEach(cleanup);

  it("evicts nothing on the first render", () => {
    renderHook(() =>
      useEvictSupersededAst({ plain: "file:a.ts:1" }, { diff: "d1" }),
    );

    expect(evictFileFromCache).not.toHaveBeenCalled();
    expect(evictDiffFromCache).not.toHaveBeenCalled();
  });

  it("evicts the key an edit replaced", () => {
    const { rerender } = renderHook(
      ({ key }: { key: string }) => useEvictSupersededAst({ plain: key }, NONE),
      { initialProps: { key: "file:a.ts:1" } },
    );

    rerender({ key: "file:a.ts:2" });

    expect(evictFileFromCache).toHaveBeenCalledExactlyOnceWith("file:a.ts:1");
  });

  it("holds a key that survives a re-render", () => {
    const { rerender } = renderHook(() =>
      useEvictSupersededAst({ plain: "file:a.ts:1" }, { diff: "d1" }),
    );

    rerender();
    rerender();

    expect(evictFileFromCache).not.toHaveBeenCalled();
    expect(evictDiffFromCache).not.toHaveBeenCalled();
  });

  it("evicts only the slot that moved", () => {
    const { rerender } = renderHook(
      ({ patch }: { patch: string }) =>
        useEvictSupersededAst(NONE, { pair: "p1", patch }),
      { initialProps: { patch: "patch:a.ts:1" } },
    );

    rerender({ patch: "patch:a.ts:2" });

    expect(evictDiffFromCache).toHaveBeenCalledExactlyOnceWith("patch:a.ts:1");
  });

  it("does not evict a slot that merely went empty", () => {
    // Toggling to old/new view stops asking for the diff without superseding
    // it — the toggle back wants the very same AST.
    const { rerender } = renderHook(
      ({ diff }: { diff: string | undefined }) =>
        useEvictSupersededAst(NONE, { diff }),
      { initialProps: { diff: "d1" as string | undefined } },
    );

    rerender({ diff: undefined });
    rerender({ diff: "d1" });

    expect(evictDiffFromCache).not.toHaveBeenCalled();
  });

  it("recognizes a supersession across an empty gap", () => {
    // Toggle away, let the file be edited underneath, toggle back: the key the
    // slot held before the gap is the one that is now dead.
    const { rerender } = renderHook(
      ({ diff }: { diff: string | undefined }) =>
        useEvictSupersededAst(NONE, { diff }),
      { initialProps: { diff: "d1" as string | undefined } },
    );

    rerender({ diff: undefined });
    rerender({ diff: "d2" });

    expect(evictDiffFromCache).toHaveBeenCalledExactlyOnceWith("d1");
  });

  it("evicts nothing when a surface swaps between its diff and plain slots", () => {
    const { rerender } = renderHook(
      ({ plain, diff }: { plain?: string; diff?: string }) =>
        useEvictSupersededAst({ plain }, { diff }),
      {
        initialProps: { plain: undefined, diff: "d1" } as {
          plain?: string;
          diff?: string;
        },
      },
    );

    rerender({ plain: "file:a.ts:3", diff: undefined });
    rerender({ plain: undefined, diff: "d1" });

    expect(evictFileFromCache).not.toHaveBeenCalled();
    expect(evictDiffFromCache).not.toHaveBeenCalled();
  });

  it("does not evict on unmount, so scrolling back still hits the cache", () => {
    const { unmount } = renderHook(() =>
      useEvictSupersededAst({ plain: "file:a.ts:1" }, { diff: "d1" }),
    );

    unmount();

    expect(evictFileFromCache).not.toHaveBeenCalled();
    expect(evictDiffFromCache).not.toHaveBeenCalled();
  });

  it("survives a pool that has not come up yet, and tracks keys through it", () => {
    pool = undefined;
    const { rerender } = renderHook(
      ({ key }: { key: string }) => useEvictSupersededAst({ plain: key }, NONE),
      { initialProps: { key: "file:a.ts:1" } },
    );

    // Nothing was highlighted without a pool, so nothing is cached to evict.
    expect(() => rerender({ key: "file:a.ts:2" })).not.toThrow();

    // Once it arrives, the keys minted meanwhile are the ones it supersedes.
    pool = { evictFileFromCache, evictDiffFromCache };
    rerender({ key: "file:a.ts:3" });

    expect(evictFileFromCache).toHaveBeenCalledExactlyOnceWith("file:a.ts:2");
  });
});

describe("diffCacheKey", () => {
  it("joins the two file keys the way pierre does", () => {
    expect(diffCacheKey("old:a.ts:1", "new:a.ts:2")).toBe(
      "old:a.ts:1:new:a.ts:2",
    );
  });

  it("is undefined unless both sides have a key", () => {
    expect(diffCacheKey(undefined, "new:a.ts:2")).toBeUndefined();
    expect(diffCacheKey("old:a.ts:1", undefined)).toBeUndefined();
  });
});
