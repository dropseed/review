import type { ApiClient } from "./client";

/**
 * Read calls that two callers can safely share one answer to.
 *
 * Every entry is a pure function of its arguments for as long as a single call
 * takes, so overlapping identical requests — React's dev-mode double effect, a
 * watcher refresh landing on top of a review switch — can join the first one
 * instead of forking a second git pass. Anything that mutates, or that a caller
 * might reasonably re-issue to observe a change (file content, review state),
 * is deliberately absent.
 */
const COALESCED_READS = new Set<keyof ApiClient>([
  "listFiles",
  "listAllFiles",
  "listRepoFiles",
  "getAllHunks",
  "getFileSymbolDiffs",
  "getRepoSymbols",
  "getHunkAttribution",
  "listAllReviewsGlobal",
  "listAllLocalActivity",
  "getTrustTaxonomy",
  // Sidebar metadata: one pair of git calls per repo, resolved for every repo
  // at once, and kicked off from more than one place on startup.
  "getRemoteInfo",
  "getDefaultBranch",
]);

/**
 * Make a client's listed reads resolve identical in-flight calls from one
 * request. Returns the same client, with those methods replaced.
 *
 * The entry is dropped as soon as the call settles, so this is strictly a
 * concurrency guard — never a cache. A caller that starts after the previous
 * request finished always gets fresh data.
 */
export function coalesceReads(client: ApiClient): ApiClient {
  const inFlight = new Map<string, Promise<unknown>>();

  // Replace the listed methods in place rather than proxying property access:
  // callers keep a stable function identity, which matters for anything that
  // holds a method in a React dependency or tests it for existence.
  for (const name of COALESCED_READS) {
    const original = client[name];
    if (typeof original !== "function") continue;
    const call = (original as (...a: unknown[]) => Promise<unknown>).bind(
      client,
    );

    (client as unknown as Record<string, unknown>)[name] = (
      ...args: unknown[]
    ): Promise<unknown> => {
      const key = `${name}:${JSON.stringify(args)}`;
      const existing = inFlight.get(key);
      if (existing) return existing;

      const tracked = call(...args).finally(() => inFlight.delete(key));
      inFlight.set(key, tracked);
      return tracked;
    };
  }

  return client;
}
