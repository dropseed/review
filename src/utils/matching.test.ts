import { describe, it, expect } from "vitest";
import {
  matchesPattern,
  matchesAnyPattern,
  findMatchingPattern,
  anyLabelMatchesAnyPattern,
  anyLabelMatchesPattern,
} from "./matching";

describe("matchesPattern", () => {
  describe("exact matches", () => {
    it("matches identical strings", () => {
      expect(matchesPattern("imports:added", "imports:added")).toBe(true);
    });

    it("does not match different strings", () => {
      expect(matchesPattern("imports:added", "imports:removed")).toBe(false);
    });

    it("does not match prefix-only without wildcard", () => {
      // IMPORTANT: "imports" without wildcard should NOT match "imports:added"
      expect(matchesPattern("imports:added", "imports")).toBe(false);
    });
  });

  describe("wildcard suffix patterns", () => {
    it("imports:* matches imports:added", () => {
      expect(matchesPattern("imports:added", "imports:*")).toBe(true);
    });

    it("imports:* matches imports:removed", () => {
      expect(matchesPattern("imports:removed", "imports:*")).toBe(true);
    });

    it("imports:* does not match comments:added", () => {
      expect(matchesPattern("comments:added", "imports:*")).toBe(false);
    });

    it("formatting:* matches formatting:whitespace", () => {
      expect(matchesPattern("formatting:whitespace", "formatting:*")).toBe(
        true,
      );
    });
  });

  describe("wildcard prefix patterns", () => {
    it("*:added matches imports:added", () => {
      expect(matchesPattern("imports:added", "*:added")).toBe(true);
    });

    it("*:added matches comments:added", () => {
      expect(matchesPattern("comments:added", "*:added")).toBe(true);
    });

    it("*:added does not match imports:removed", () => {
      expect(matchesPattern("imports:removed", "*:added")).toBe(false);
    });

    it("*:removed matches imports:removed", () => {
      expect(matchesPattern("imports:removed", "*:removed")).toBe(true);
    });
  });

  describe("wildcard only", () => {
    it("* matches anything", () => {
      expect(matchesPattern("imports:added", "*")).toBe(true);
      expect(matchesPattern("anything", "*")).toBe(true);
    });
  });

  describe("multiple wildcards", () => {
    it("*:* matches any label with colon", () => {
      expect(matchesPattern("imports:added", "*:*")).toBe(true);
      expect(matchesPattern("a:b", "*:*")).toBe(true);
    });
  });

  describe("regex special characters", () => {
    it("escapes dots correctly", () => {
      // A dot in the pattern should match literal dot, not any character
      expect(matchesPattern("file.ext", "file.ext")).toBe(true);
      expect(matchesPattern("filexext", "file.ext")).toBe(false);
    });

    it("escapes other special chars", () => {
      expect(matchesPattern("foo[bar]", "foo[bar]")).toBe(true);
      expect(matchesPattern("foo(bar)", "foo(bar)")).toBe(true);
    });
  });

  describe("empty strings and edge cases", () => {
    it("empty label matches empty pattern", () => {
      expect(matchesPattern("", "")).toBe(true);
    });

    it("empty label matches * pattern", () => {
      expect(matchesPattern("", "*")).toBe(true);
    });

    it("non-empty label does not match empty pattern", () => {
      expect(matchesPattern("something", "")).toBe(false);
    });
  });
});

describe("matchesAnyPattern", () => {
  it("returns true if label matches any pattern in list", () => {
    expect(
      matchesAnyPattern("imports:added", ["formatting:*", "imports:*"]),
    ).toBe(true);
  });

  it("returns false if label matches no patterns", () => {
    expect(
      matchesAnyPattern("comments:added", ["formatting:*", "imports:*"]),
    ).toBe(false);
  });

  it("returns false for empty pattern list", () => {
    expect(matchesAnyPattern("imports:added", [])).toBe(false);
  });
});

describe("findMatchingPattern", () => {
  it("returns the first matching pattern", () => {
    expect(
      findMatchingPattern("imports:added", [
        "imports:added",
        "imports:*",
        "*:added",
      ]),
    ).toBe("imports:added");
  });

  it("returns undefined if no pattern matches", () => {
    expect(
      findMatchingPattern("comments:added", ["imports:*", "formatting:*"]),
    ).toBeUndefined();
  });

  it("returns the first match when multiple patterns match", () => {
    expect(findMatchingPattern("imports:added", ["*:added", "imports:*"])).toBe(
      "*:added",
    );
  });
});

describe("anyLabelMatchesAnyPattern", () => {
  it("returns true if any label matches any pattern", () => {
    expect(
      anyLabelMatchesAnyPattern(
        ["imports:added", "comments:removed"],
        ["formatting:*", "imports:*"],
      ),
    ).toBe(true);
  });

  it("returns false if no label matches any pattern", () => {
    expect(
      anyLabelMatchesAnyPattern(
        ["comments:added", "code:logic"],
        ["formatting:*", "imports:*"],
      ),
    ).toBe(false);
  });

  it("returns false for empty label list", () => {
    expect(anyLabelMatchesAnyPattern([], ["imports:*"])).toBe(false);
  });

  it("returns false for empty pattern list", () => {
    expect(anyLabelMatchesAnyPattern(["imports:added"], [])).toBe(false);
  });
});

describe("anyLabelMatchesPattern", () => {
  it("returns true if any label matches the pattern", () => {
    expect(
      anyLabelMatchesPattern(
        ["imports:added", "comments:removed"],
        "imports:*",
      ),
    ).toBe(true);
  });

  it("returns false if no label matches the pattern", () => {
    expect(
      anyLabelMatchesPattern(["comments:added", "code:logic"], "imports:*"),
    ).toBe(false);
  });

  it("returns false for empty label list", () => {
    expect(anyLabelMatchesPattern([], "imports:*")).toBe(false);
  });
});

// Shared test cases that should pass in both TypeScript and Rust
// These are the parity tests referenced in Phase 3
describe("parity test cases (must match Rust implementation)", () => {
  const testCases = [
    // Exact matches
    { label: "imports:added", pattern: "imports:added", expected: true },
    { label: "imports:added", pattern: "imports:removed", expected: false },

    // Suffix wildcards
    { label: "imports:added", pattern: "imports:*", expected: true },
    { label: "comments:added", pattern: "imports:*", expected: false },

    // Prefix wildcards
    { label: "imports:added", pattern: "*:added", expected: true },
    { label: "imports:removed", pattern: "*:added", expected: false },

    // CRITICAL: Pattern without wildcard should NOT match as prefix
    { label: "imports:added", pattern: "imports", expected: false },

    // Regex special chars should be literal
    { label: "file.name", pattern: "file.name", expected: true },
    { label: "filexname", pattern: "file.name", expected: false },
  ];

  testCases.forEach(({ label, pattern, expected }) => {
    it(`matchesPattern("${label}", "${pattern}") === ${expected}`, () => {
      expect(matchesPattern(label, pattern)).toBe(expected);
    });
  });
});
