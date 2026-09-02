import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

/**
 * One highlighter object for the whole session, exactly as shiki gives us — the
 * point of these tests is that its identity never changes, so identity can't be
 * what tells a consumer its grammar has arrived.
 */
const loadedLanguages: string[] = [];
const loadLanguage = vi.fn(async (lang: string) => {
  loadedLanguages.push(lang);
});
const sharedHighlighter = {
  getLoadedLanguages: () => loadedLanguages,
  loadLanguage,
};

const createHighlighter = vi.fn(
  async (_options?: unknown) => sharedHighlighter,
);

vi.mock("shiki", () => ({
  createHighlighter: (options: unknown) => createHighlighter(options),
}));

const { useHighlighter, getLanguageFromFilename } =
  await import("./useHighlighter");

describe("useHighlighter", () => {
  beforeEach(() => {
    loadedLanguages.length = 0;
    loadLanguage.mockClear();
    createHighlighter.mockClear();
  });

  afterEach(cleanup);

  it("loads only the grammar it was asked for", async () => {
    const { result } = renderHook(() => useHighlighter("python"));

    await waitFor(() => expect(result.current.highlighter).not.toBeNull());

    expect(createHighlighter).toHaveBeenCalledOnce();
    expect(createHighlighter).toHaveBeenCalledWith(
      expect.objectContaining({ langs: [] }),
    );
    expect(loadLanguage).toHaveBeenCalledExactlyOnceWith("python");
  });

  it("reports nothing to highlight for a null language", () => {
    const { result } = renderHook(() => useHighlighter(null));

    expect(result.current.highlighter).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(loadLanguage).not.toHaveBeenCalled();
  });

  it("withholds the highlighter until the new language is loaded", async () => {
    // The regression: the highlighter is a singleton, so a naive
    // `setHighlighter(shared)` is a no-op under Object.is and the consumer
    // keeps a truthy highlighter it cannot tokenize the new language with.
    const { result, rerender } = renderHook(
      ({ lang }: { lang: "python" | "ruby" }) => useHighlighter(lang),
      { initialProps: { lang: "python" } as { lang: "python" | "ruby" } },
    );
    await waitFor(() => expect(result.current.highlighter).not.toBeNull());

    rerender({ lang: "ruby" });

    expect(result.current.highlighter).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.highlighter).not.toBeNull());
    // `toContain`, not an exact list: grammar loads are memoized in module
    // state that outlives a single test, so an earlier one may already have
    // fetched python.
    expect(loadedLanguages).toContain("ruby");
  });

  it("shares one load between concurrent consumers of a language", async () => {
    const { result } = renderHook(() => {
      useHighlighter("rust");
      useHighlighter("rust");
      return useHighlighter("rust");
    });

    await waitFor(() => expect(result.current.highlighter).not.toBeNull());

    expect(loadLanguage).toHaveBeenCalledExactlyOnceWith("rust");
  });

  it("surfaces a failed grammar load, and retries it next time", async () => {
    loadLanguage.mockRejectedValueOnce(new Error("no such grammar"));

    const first = renderHook(() => useHighlighter("lua"));
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    expect(first.result.current.highlighter).toBeNull();
    cleanup();

    // A failure is not remembered as settled, or the language would be
    // unhighlightable for the rest of the session.
    const second = renderHook(() => useHighlighter("lua"));
    await waitFor(() =>
      expect(second.result.current.highlighter).not.toBeNull(),
    );
  });
});

describe("getLanguageFromFilename", () => {
  it("maps by extension", () => {
    expect(getLanguageFromFilename("src/main.rs")).toBe("rust");
    expect(getLanguageFromFilename("a/b/c.tsx")).toBe("tsx");
  });

  it("prefers a known bare filename", () => {
    expect(getLanguageFromFilename("deep/path/Dockerfile")).toBe("dockerfile");
  });

  it("is null for an unknown extension", () => {
    expect(getLanguageFromFilename("notes.xyz")).toBeNull();
  });
});
