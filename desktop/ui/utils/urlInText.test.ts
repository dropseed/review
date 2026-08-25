import { describe, it, expect } from "vitest";
import { cleanUrlTrailing, findUrlAtOffset } from "./urlInText";

describe("cleanUrlTrailing", () => {
  it("strips trailing sentence punctuation", () => {
    expect(cleanUrlTrailing("https://example.com/foo.")).toBe(
      "https://example.com/foo",
    );
    expect(cleanUrlTrailing("https://example.com/foo,")).toBe(
      "https://example.com/foo",
    );
    expect(cleanUrlTrailing("https://example.com/foo...")).toBe(
      "https://example.com/foo",
    );
  });

  it("strips an unbalanced trailing paren from a sentence-wrapped URL", () => {
    expect(cleanUrlTrailing("https://example.com/foo)")).toBe(
      "https://example.com/foo",
    );
    // Doubly-wrapped: `((url))`.
    expect(cleanUrlTrailing("https://example.com/foo))")).toBe(
      "https://example.com/foo",
    );
  });

  it("keeps a balanced trailing paren that belongs to the URL itself", () => {
    // Wikipedia-style: the URL's own path contains a balanced `(bar)`.
    expect(cleanUrlTrailing("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
  });

  it("strips only the unbalanced outer paren, keeping the URL's own pair", () => {
    // `(https://en.wikipedia.org/wiki/Foo_(bar))` — outer parens are prose,
    // inner pair is the URL's.
    expect(cleanUrlTrailing("https://en.wikipedia.org/wiki/Foo_(bar))")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
  });

  it("leaves a URL with no trailing punctuation untouched", () => {
    expect(cleanUrlTrailing("https://example.com/foo")).toBe(
      "https://example.com/foo",
    );
  });
});

describe("findUrlAtOffset", () => {
  it("finds the URL a single tap offset falls inside", () => {
    const line = "see https://example.com/foo for details";
    const start = line.indexOf("https");
    expect(findUrlAtOffset(line, start + 3)).toBe("https://example.com/foo");
  });

  it("matches when the given range overlaps the URL at either edge", () => {
    const line = "see https://example.com/foo now";
    const urlStart = line.indexOf("https");
    const urlEnd = urlStart + "https://example.com/foo".length;
    // Range ending exactly at the URL's start doesn't overlap.
    expect(findUrlAtOffset(line, 0, urlStart)).toBeNull();
    // Range starting exactly at the URL's end doesn't overlap either.
    expect(findUrlAtOffset(line, urlEnd, line.length)).toBeNull();
    // A range that just barely overlaps the last character does.
    expect(findUrlAtOffset(line, urlEnd - 1, urlEnd + 5)).toBe(
      "https://example.com/foo",
    );
  });

  it("returns null when there is no URL on the line", () => {
    expect(findUrlAtOffset("just some plain text", 5)).toBeNull();
  });

  it("resolves a click inside a markdown-style link to the trimmed URL", () => {
    const line = "[docs](https://example.com/path) explains it";
    const offset = line.indexOf("example");
    expect(findUrlAtOffset(line, offset)).toBe("https://example.com/path");
  });

  it("preserves a Wikipedia-style URL's own trailing paren when clicked", () => {
    const line = "see (https://en.wikipedia.org/wiki/Foo_(bar)) for more";
    const offset = line.indexOf("Foo_");
    expect(findUrlAtOffset(line, offset)).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
  });
});
