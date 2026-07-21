import { describe, it, expect } from "vitest";
import {
  effectiveHunkStatus,
  hunkMatchesFilter,
  isEmptyFilter,
  type HunkFilter,
} from "./hunkFilter";
import { attributed, type HunkState } from "./index";

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

  it("an explicit approve wins over a trusted label", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
      status: attributed("approved", "ui"),
    };
    expect(effectiveHunkStatus(hs, trustList)).toBe("approved");
  });
});

describe("hunkMatchesFilter", () => {
  it("empty filter matches everything", () => {
    expect(match(undefined, {})).toBe(true);
    expect(match({ status: attributed("approved", "ui") }, {})).toBe(true);
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

  it("filters by file glob", () => {
    const hs: HunkState = { status: attributed("approved", "ui") };
    expect(match(hs, { file: "src/*.ts" }, "src/a.ts")).toBe(true);
    expect(match(hs, { file: "src/*.ts" }, "test/a.ts")).toBe(false);
  });

  it("AND-composes across axes", () => {
    const hs: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    // trusted AND in src/ → matches
    expect(
      match(hs, { status: ["trusted"], file: "src/*.ts" }, "src/a.ts"),
    ).toBe(true);
    // trusted AND in test/ → fails the file axis
    expect(
      match(hs, { status: ["trusted"], file: "src/*.ts" }, "test/a.ts"),
    ).toBe(false);
    // unreviewed filter → fails the status axis even though file matches
    expect(
      match(hs, { status: ["unreviewed"], file: "src/*.ts" }, "src/a.ts"),
    ).toBe(false);
  });
});

describe("isEmptyFilter", () => {
  it("recognizes the empty filter", () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ status: [] })).toBe(true);
    expect(isEmptyFilter({ status: ["approved"] })).toBe(false);
    expect(isEmptyFilter({ file: "src/*" })).toBe(false);
  });
});
