import { describe, it, expect, beforeEach, vi } from "vitest";

const isTauriEnvironment = vi.fn(() => true);
vi.mock("../api/client", () => ({
  isTauriEnvironment: () => isTauriEnvironment(),
}));
vi.mock("../api", () => ({ getApiClient: () => ({}) }));

const { onScanRender, bufferedRenderCount } = await import("./reactScanLog");

/** The shape `onRender` hands us, with only the fields we serialize. */
function renders(n: number) {
  return Array.from({ length: n }, () => ({
    componentName: "DiffView",
    phase: 1,
    time: 1,
    count: 1,
    forget: false,
    didCommit: true,
    unnecessary: false,
    changes: [],
  })) as unknown as Parameters<typeof onScanRender>[1];
}

const fiber = null as unknown as Parameters<typeof onScanRender>[0];

describe("react-scan render log", () => {
  beforeEach(() => {
    isTauriEnvironment.mockReturnValue(true);
    // Drain whatever a previous test left behind.
    onScanRender(fiber, renders(0));
  });

  /**
   * The regression: the writer is Tauri-only and `flush` bailed on that before
   * draining, so a browser session buffered every render forever — 250MB of JS
   * heap in one sitting.
   */
  it("buffers nothing when there is nowhere to write", () => {
    isTauriEnvironment.mockReturnValue(false);
    const before = bufferedRenderCount();

    onScanRender(fiber, renders(500));

    expect(bufferedRenderCount()).toBe(before);
  });

  it("caps what it holds while waiting for the log path", () => {
    onScanRender(fiber, renders(12000));

    expect(bufferedRenderCount()).toBeLessThanOrEqual(5000);
  });
});
