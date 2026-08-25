import { describe, it, expect } from "vitest";
import {
  reviewUrl,
  splitRoutePrefix,
  orgAvatarUrl,
  repoDisplayName,
} from "./repo-identity";

describe("reviewUrl", () => {
  it("builds the review route from a route prefix and ref", () => {
    expect(reviewUrl("owner/repo", "main")).toBe("/owner/repo/review/main");
  });

  it("encodes a ref containing a slash so it stays one path segment", () => {
    expect(reviewUrl("owner/repo", "feature/foo")).toBe(
      "/owner/repo/review/feature%2Ffoo",
    );
  });
});

describe("splitRoutePrefix", () => {
  it("splits on the first slash into org and repo", () => {
    expect(splitRoutePrefix("owner/repo")).toEqual({
      org: "owner",
      repo: "repo",
    });
  });

  it("treats a local prefix the same as any other owner/repo pair", () => {
    expect(splitRoutePrefix("local/dirname")).toEqual({
      org: "local",
      repo: "dirname",
    });
  });

  it("falls back to the local org when there is no slash at all", () => {
    expect(splitRoutePrefix("reponame")).toEqual({
      org: "local",
      repo: "reponame",
    });
  });

  it("falls back to the local org for a leading slash, keeping it in repo", () => {
    // `slash <= 0` covers both "no slash" and "slash at index 0" —
    // the whole string (leading slash included) is returned as-is.
    expect(splitRoutePrefix("/reponame")).toEqual({
      org: "local",
      repo: "/reponame",
    });
  });

  it("only splits at the first slash, keeping the rest in repo", () => {
    expect(splitRoutePrefix("owner/repo/sub")).toEqual({
      org: "owner",
      repo: "repo/sub",
    });
  });
});

describe("orgAvatarUrl", () => {
  it("builds an avatar URL from the first path segment", () => {
    expect(orgAvatarUrl("https://github.com/dropseed/review")).toBe(
      "https://github.com/dropseed.png?size=64",
    );
  });

  it("returns null for a null or undefined browse URL", () => {
    expect(orgAvatarUrl(null)).toBeNull();
    expect(orgAvatarUrl(undefined)).toBeNull();
  });

  it("returns null when the URL can't be parsed", () => {
    expect(orgAvatarUrl("not a url")).toBeNull();
  });

  it("returns null when the URL has no path segment to use as an org", () => {
    expect(orgAvatarUrl("https://github.com")).toBeNull();
    expect(orgAvatarUrl("https://github.com/")).toBeNull();
  });
});

describe("repoDisplayName", () => {
  it("uses the route prefix's repo half when present", () => {
    expect(repoDisplayName("owner/repo", "fallback")).toBe("repo");
  });

  it("uses the fallback when the route prefix is undefined", () => {
    expect(repoDisplayName(undefined, "fallback")).toBe("fallback");
  });

  it("uses the fallback when the route prefix's repo half is empty", () => {
    expect(repoDisplayName("owner/", "fallback")).toBe("fallback");
  });
});
