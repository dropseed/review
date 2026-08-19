import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

const writeText = vi.fn<(text: string) => Promise<void>>();
const openUrl = vi.fn();

vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    clipboard: { writeText },
    opener: { openUrl },
  }),
}));

import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): ReactNode {
  throw new Error("undefined is not an object (evaluating 'A.label')");
}

/**
 * The boundary logs the error it caught, and React logs its own copy of it —
 * both expected here, and both pure noise in the test output.
 */
function renderBoom(): void {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  quiet.mockRestore();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the crash screen's Copy button", () => {
  /**
   * It used to call `navigator.clipboard` directly, which is `undefined` in the
   * desktop app: `tauri://localhost` is not a secure context in WKWebView. So
   * the property access threw inside the click handler and the button did
   * nothing at all, on the one screen whose entire job is handing the error to
   * someone who can act on it. Through the platform service it reaches the
   * Tauri clipboard plugin, the same way every other copy in the app does.
   */
  it("copies through the platform clipboard, not navigator", async () => {
    writeText.mockResolvedValue();
    renderBoom();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("A.label");
    expect(
      await screen.findByRole("button", { name: "Copied!" }),
    ).toBeDefined();
  });

  /** A lie about the text being on the clipboard is how a stack trace is lost. */
  it("says so when the copy fails instead of claiming it worked", async () => {
    writeText.mockRejectedValue(new Error("no clipboard here either"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBoom();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(
      await screen.findByRole("button", { name: "Copy failed" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Copied!" })).toBeNull();
    quiet.mockRestore();
  });
});
