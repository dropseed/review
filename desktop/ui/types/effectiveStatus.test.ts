import { describe, it, expect } from "vitest";
import { attributed, effectiveHunkStatus, type HunkState } from "./index";

const trustList = ["imports:*", "formatting:whitespace"];

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
