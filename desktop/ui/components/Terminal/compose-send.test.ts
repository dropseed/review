import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import { submitComposed } from "./compose-send";

function fakeClient(terminalSubmit: ApiClient["terminalSubmit"]): ApiClient {
  return { terminalSubmit } as unknown as ApiClient;
}

describe("submitting a composed message", () => {
  it("hands the text to the client, which owns the settle", async () => {
    const terminalSubmit = vi.fn(async () => {});
    await submitComposed(fakeClient(terminalSubmit), "t1", "run the tests");
    expect(terminalSubmit).toHaveBeenCalledWith("t1", "run the tests");
  });

  it("sends the text exactly as typed, newlines and all", async () => {
    const terminalSubmit = vi.fn(async () => {});
    await submitComposed(fakeClient(terminalSubmit), "t1", "  first\nsecond");
    // No trim, no join: the Enter that submits is the only byte added, and it
    // is added past this point.
    expect(terminalSubmit).toHaveBeenCalledWith("t1", "  first\nsecond");
  });

  it("propagates a failure rather than reporting a message that never went", async () => {
    const terminalSubmit = vi.fn().mockRejectedValue(new Error("gone"));
    await expect(
      submitComposed(fakeClient(terminalSubmit), "t1", "hi"),
    ).rejects.toThrow("gone");
  });
});
