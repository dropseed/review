import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "./client";
import { coalesceReads } from "./coalesce";

/** Minimal stand-in: only the methods a test touches have to exist. */
function stubClient(overrides: Partial<ApiClient>): ApiClient {
  return overrides as ApiClient;
}

describe("coalesceReads", () => {
  it("shares one request between concurrent callers with the same arguments", async () => {
    const listFiles = vi.fn().mockResolvedValue([]);
    const client = coalesceReads(stubClient({ listFiles }));

    const comparison = { base: "main", head: "a", key: "main..a" } as never;
    await Promise.all([
      client.listFiles("/repo", comparison),
      client.listFiles("/repo", comparison),
    ]);

    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps calls with different arguments apart", async () => {
    const listFiles = vi.fn().mockResolvedValue([]);
    const client = coalesceReads(stubClient({ listFiles }));

    const comparison = { base: "main", head: "a", key: "main..a" } as never;
    await Promise.all([
      client.listFiles("/repo-a", comparison),
      client.listFiles("/repo-b", comparison),
    ]);

    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it("is a concurrency guard, not a cache", async () => {
    const listFiles = vi.fn().mockResolvedValue([]);
    const client = coalesceReads(stubClient({ listFiles }));

    const comparison = { base: "main", head: "a", key: "main..a" } as never;
    await client.listFiles("/repo", comparison);
    await client.listFiles("/repo", comparison);

    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight entry when a call rejects", async () => {
    const listFiles = vi.fn().mockRejectedValue(new Error("boom"));
    const client = coalesceReads(stubClient({ listFiles }));

    const comparison = { base: "main", head: "a", key: "main..a" } as never;
    await expect(client.listFiles("/repo", comparison)).rejects.toThrow("boom");
    await expect(client.listFiles("/repo", comparison)).rejects.toThrow("boom");

    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it("leaves methods outside the read set alone", async () => {
    const saveReviewState = vi.fn().mockResolvedValue(undefined);
    const client = coalesceReads(stubClient({ saveReviewState }));

    await Promise.all([
      client.saveReviewState("/repo", {} as never),
      client.saveReviewState("/repo", {} as never),
    ]);

    expect(saveReviewState).toHaveBeenCalledTimes(2);
  });

  it("keeps a stable identity for each wrapped method", () => {
    const client = coalesceReads(
      stubClient({ listFiles: vi.fn().mockResolvedValue([]) }),
    );

    expect(client.listFiles).toBe(client.listFiles);
  });
});
