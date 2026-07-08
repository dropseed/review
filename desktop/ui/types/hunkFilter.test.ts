import { describe, it, expect } from "vitest";
import {
  effectiveHunkStatus,
  hunkMatchesFilter,
  isEmptyFilter,
  selectHunkIds,
  UNCOMMITTED_COMMIT,
  type HunkFilter,
} from "./hunkFilter";
import {
  attributed,
  type DiffHunk,
  type HunkState,
  type ReviewState,
} from "./index";

const trustList = ["imports:*", "formatting:whitespace"];

function match(
  hunkState: HunkState | undefined,
  filter: HunkFilter,
  filePath = "src/a.ts",
): boolean {
  return hunkMatchesFilter({ hunkState, filePath, trustList, filter });
}

describe("effectiveHunkStatus", () => {
  it("explicit status wins over everything", () => {
    expect(
      effectiveHunkStatus({ status: attributed("approved", "ui") }, trustList),
    ).toBe("approved");
    expect(
      effectiveHunkStatus({ status: attributed("rejected", "cli") }, trustList),
    ).toBe("rejected");
    expect(
      effectiveHunkStatus(
        { status: attributed("saved_for_later", "ui") },
        trustList,
      ),
    ).toBe("saved");
  });

  it("status wins even when the label is trust-listed", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
      status: attributed("rejected", "ui"),
    };
    expect(effectiveHunkStatus(hs, trustList)).toBe("rejected");
  });

  it("trust-listed label reads as trusted when no status", () => {
    expect(
      effectiveHunkStatus(
        { classification: attributed(["imports:added"], "static") },
        trustList,
      ),
    ).toBe("trusted");
  });

  it("non-trusted label and no status reads as unreviewed", () => {
    expect(
      effectiveHunkStatus(
        { classification: attributed(["code:logic"], "static") },
        trustList,
      ),
    ).toBe("unreviewed");
  });

  it("undefined hunk state is unreviewed", () => {
    expect(effectiveHunkStatus(undefined, trustList)).toBe("unreviewed");
  });

  it("high risk vetoes auto-trust — stays unreviewed despite a trusted label", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
      risk: attributed("high", "agent"),
    };
    expect(effectiveHunkStatus(hs, trustList)).toBe("unreviewed");
  });

  it("low risk does not veto trust", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
      risk: attributed("low", "agent"),
    };
    expect(effectiveHunkStatus(hs, trustList)).toBe("trusted");
  });

  it("an explicit approve still wins over high risk", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
      risk: attributed("high", "agent"),
      status: attributed("approved", "ui"),
    };
    expect(effectiveHunkStatus(hs, trustList)).toBe("approved");
  });
});

describe("hunkMatchesFilter", () => {
  it("empty filter matches everything", () => {
    expect(match(undefined, {})).toBe(true);
    expect(match({ risk: attributed("high", "agent") }, {})).toBe(true);
  });

  it("filters by risk", () => {
    const high: HunkState = { risk: attributed("high", "agent") };
    const low: HunkState = { risk: attributed("low", "ui") };
    expect(match(high, { risk: ["high"] })).toBe(true);
    expect(match(low, { risk: ["high"] })).toBe(false);
    expect(match(undefined, { risk: ["high"] })).toBe(false);
    // values within an axis OR together
    expect(match(low, { risk: ["low", "high"] })).toBe(true);
  });

  it("filters by effective status", () => {
    const approved: HunkState = { status: attributed("approved", "ui") };
    const trusted: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    expect(match(approved, { status: ["approved"] })).toBe(true);
    expect(match(approved, { status: ["unreviewed"] })).toBe(false);
    expect(match(trusted, { status: ["trusted"] })).toBe(true);
    expect(match(undefined, { status: ["unreviewed"] })).toBe(true);
  });

  it("filters by label glob", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    expect(match(hs, { label: "imports:*" })).toBe(true);
    expect(match(hs, { label: "formatting:*" })).toBe(false);
    expect(match(undefined, { label: "imports:*" })).toBe(false);
  });

  it("filters by file glob", () => {
    const hs: HunkState = { risk: attributed("high", "agent") };
    expect(match(hs, { file: "src/*.ts" }, "src/a.ts")).toBe(true);
    expect(match(hs, { file: "src/*.ts" }, "test/a.ts")).toBe(false);
  });

  it("filters by commit attribution", () => {
    const hunkCommits = { "src/a.ts:1": ["sha1", "sha2"] };
    expect(
      hunkMatchesFilter({
        hunkId: "src/a.ts:1",
        hunkState: undefined,
        filePath: "src/a.ts",
        trustList,
        filter: { commits: ["sha1"] },
        hunkCommits,
      }),
    ).toBe(true);
    expect(
      hunkMatchesFilter({
        hunkId: "src/a.ts:1",
        hunkState: undefined,
        filePath: "src/a.ts",
        trustList,
        filter: { commits: ["sha3"] },
        hunkCommits,
      }),
    ).toBe(false);
    // No attribution data / unattributed hunk -> fails closed, not matched
    expect(
      hunkMatchesFilter({
        hunkId: "src/b.ts:2",
        hunkState: undefined,
        filePath: "src/b.ts",
        trustList,
        filter: { commits: ["sha1"] },
        hunkCommits,
      }),
    ).toBe(false);
  });

  it("filters by multiple commits (union — matches any selected sha)", () => {
    const hunkCommits = {
      "src/a.ts:1": ["sha1"],
      "src/b.ts:2": ["sha2"],
      "test/c.ts:3": ["sha3"],
    };
    expect(
      hunkMatchesFilter({
        hunkId: "src/a.ts:1",
        hunkState: undefined,
        filePath: "src/a.ts",
        trustList,
        filter: { commits: ["sha1", "sha2"] },
        hunkCommits,
      }),
    ).toBe(true);
    expect(
      hunkMatchesFilter({
        hunkId: "src/b.ts:2",
        hunkState: undefined,
        filePath: "src/b.ts",
        trustList,
        filter: { commits: ["sha1", "sha2"] },
        hunkCommits,
      }),
    ).toBe(true);
    expect(
      hunkMatchesFilter({
        hunkId: "test/c.ts:3",
        hunkState: undefined,
        filePath: "test/c.ts",
        trustList,
        filter: { commits: ["sha1", "sha2"] },
        hunkCommits,
      }),
    ).toBe(false);
  });

  it("filters by the uncommitted sentinel — matches hunks with no attribution", () => {
    const hunkCommits = { "src/a.ts:1": ["sha1"], "src/b.ts:2": [] };
    expect(
      hunkMatchesFilter({
        hunkId: "src/b.ts:2",
        hunkState: undefined,
        filePath: "src/b.ts",
        trustList,
        filter: { commits: [UNCOMMITTED_COMMIT] },
        hunkCommits,
      }),
    ).toBe(true);
    // A hunk missing from the map entirely (never seen by attribution) also
    // counts as uncommitted.
    expect(
      hunkMatchesFilter({
        hunkId: "src/c.ts:3",
        hunkState: undefined,
        filePath: "src/c.ts",
        trustList,
        filter: { commits: [UNCOMMITTED_COMMIT] },
        hunkCommits,
      }),
    ).toBe(true);
    // A hunk WITH attribution doesn't match the sentinel alone.
    expect(
      hunkMatchesFilter({
        hunkId: "src/a.ts:1",
        hunkState: undefined,
        filePath: "src/a.ts",
        trustList,
        filter: { commits: [UNCOMMITTED_COMMIT] },
        hunkCommits,
      }),
    ).toBe(false);
  });

  it("unions the uncommitted sentinel with real shas", () => {
    const hunkCommits = { "src/a.ts:1": ["sha1"], "src/b.ts:2": [] };
    const filter: HunkFilter = { commits: ["sha1", UNCOMMITTED_COMMIT] };
    expect(
      hunkMatchesFilter({
        hunkId: "src/a.ts:1",
        hunkState: undefined,
        filePath: "src/a.ts",
        trustList,
        filter,
        hunkCommits,
      }),
    ).toBe(true);
    expect(
      hunkMatchesFilter({
        hunkId: "src/b.ts:2",
        hunkState: undefined,
        filePath: "src/b.ts",
        trustList,
        filter,
        hunkCommits,
      }),
    ).toBe(true);
  });

  it("AND-composes across axes", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
      risk: attributed("high", "agent"),
    };
    // high-risk AND in src/ → matches
    expect(match(hs, { risk: ["high"], file: "src/*.ts" }, "src/a.ts")).toBe(
      true,
    );
    // high-risk AND in test/ → fails the file axis
    expect(match(hs, { risk: ["high"], file: "src/*.ts" }, "test/a.ts")).toBe(
      false,
    );
    // low-risk filter → fails the risk axis even though file matches
    expect(match(hs, { risk: ["low"], file: "src/*.ts" }, "src/a.ts")).toBe(
      false,
    );
  });
});

describe("isEmptyFilter", () => {
  it("recognizes the empty filter", () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ status: [], risk: [] })).toBe(true);
    expect(isEmptyFilter({ risk: ["high"] })).toBe(false);
    expect(isEmptyFilter({ file: "src/*" })).toBe(false);
    expect(isEmptyFilter({ commits: ["abc123"] })).toBe(false);
  });
});

describe("selectHunkIds", () => {
  const hunks = [
    { id: "src/a.ts:1", filePath: "src/a.ts" },
    { id: "src/b.ts:2", filePath: "src/b.ts" },
    { id: "test/c.ts:3", filePath: "test/c.ts" },
  ] as DiffHunk[];

  const reviewState = {
    trustList,
    hunks: {
      "src/a.ts:1": { risk: attributed("low", "agent") },
      "src/b.ts:2": { risk: attributed("high", "agent") },
      "test/c.ts:3": { risk: attributed("low", "ui") },
    },
  } as unknown as ReviewState;

  it("selects low-risk hunk IDs in input order", () => {
    expect(selectHunkIds(hunks, reviewState, { risk: ["low"] })).toEqual([
      "src/a.ts:1",
      "test/c.ts:3",
    ]);
  });

  it("composes risk + file", () => {
    expect(
      selectHunkIds(hunks, reviewState, { risk: ["low"], file: "src/*" }),
    ).toEqual(["src/a.ts:1"]);
  });

  it("empty filter selects all", () => {
    expect(selectHunkIds(hunks, reviewState, {})).toHaveLength(3);
  });

  it("tolerates a null review state", () => {
    expect(selectHunkIds(hunks, null, { risk: ["low"] })).toEqual([]);
    expect(selectHunkIds(hunks, null, {})).toHaveLength(3);
  });
});
