import { describe, it, expect } from "vitest";
import { scoreCandidate, scoreText } from "./score";

/** Score a single string, or throw if it did not match at all. */
function must(query: string, text: string) {
  const result = scoreText(query, text);
  if (!result) throw new Error(`expected "${query}" to match "${text}"`);
  return result;
}

function indices(query: string, text: string): number[] {
  return must(query, text).best.indices;
}

function score(query: string, text: string): number {
  return must(query, text).score;
}

describe("subsequence matching", () => {
  it("returns null when the query is not a subsequence", () => {
    expect(scoreText("xyz", "abc")).toBeNull();
    expect(scoreText("abcd", "abc")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(scoreText("", "abc")).toBeNull();
    expect(scoreText("   ", "abc")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(indices("AB", "ab")).toEqual([0, 1]);
    expect(indices("ab", "AB")).toEqual([0, 1]);
  });
});

describe("alignment quality", () => {
  // Greedy left-to-right matching commits to the first occurrence of each
  // character and cannot reconsider, producing scattered matches that both
  // score worse and highlight nonsense.
  it("prefers a contiguous run over the leftmost occurrence", () => {
    expect(indices("st", "src/stores/index.ts")).toEqual([4, 5]);
  });

  it("finds a contiguous match deep in a long path", () => {
    // Previously unreachable: the search abandoned start positions past a
    // fixed 20-character window, so this matched the "o" of "desktop".
    const path = "desktop/ui/components/FileViewer/SymbolOutlinePanel.tsx";
    const at = path.indexOf("Outline");
    expect(indices("outline", path)).toEqual([
      at,
      at + 1,
      at + 2,
      at + 3,
      at + 4,
      at + 5,
      at + 6,
    ]);
  });

  it("prefers adjacent characters over jumping to a camelCase boundary", () => {
    // A capped gap penalty made distance nearly free, so the matcher would
    // cross an entire directory name to reach a capital letter.
    const path = "src/aVeryLongDirectoryNameHere/ab.ts";
    const at = path.indexOf("ab.ts");
    expect(indices("ab", path)).toEqual([at, at + 1]);
  });

  it("rewards camelCase boundaries so initialisms work", () => {
    // "fs" reads as an initialism of fileSlice; the shorter "files.ts" is a
    // worse answer despite being a shorter string.
    expect(score("fs", "fileSlice.ts")).toBeGreaterThan(
      score("fs", "files.ts"),
    );
  });

  it("rewards separator boundaries", () => {
    expect(score("ab", "foo/ab")).toBeGreaterThan(score("ab", "fooxab"));
  });

  it("prefers a prefix match over a mid-word match", () => {
    expect(score("stage", "stage-hunk")).toBeGreaterThan(
      score("stage", "unstage-hunk"),
    );
  });

  it("prefers tighter matches over sprawling ones", () => {
    expect(score("abc", "abc")).toBeGreaterThan(score("abc", "a-b-c"));
  });
});

describe("score normalization", () => {
  it("bounds an unboosted score to 0..1", () => {
    const samples: [string, string][] = [
      ["a", "a"],
      ["abc", "abc"],
      ["outline", "desktop/ui/components/FileViewer/SymbolOutlinePanel.tsx"],
      ["aeiouy", "tests/migrations/0002_mymodel1_field_1_and_more.py"],
      ["x", "x".repeat(500)],
    ];
    for (const [query, text] of samples) {
      const result = scoreText(query, text);
      if (!result) continue;
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it("gives an exact boundary-anchored contiguous match the top score", () => {
    expect(score("abc", "abc")).toBeCloseTo(1, 5);
  });

  // The previous implementation seeded its best score with -1 as a "no match"
  // sentinel and then kept only results >= 0, so a real match whose gap
  // penalties pushed it negative was silently dropped from the list.
  it("keeps poor-but-real matches instead of dropping them", () => {
    const path =
      "tests/migrations/test_migrations_squashed_partially_applied/" +
      "0002_mymodel1_field_1_mymodel2_field_2_and_more.py";
    const result = scoreText("aeiouy", path);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it("scores a poor match below a good one of the same query", () => {
    const good = score("abc", "abc.ts");
    const poor = score("abc", "a-long-b-winding-c-road.ts");
    expect(poor).toBeLessThan(good);
    expect(poor).toBeGreaterThan(0);
  });

  it("does not let string length dominate structural quality", () => {
    // A boundary-anchored contiguous match in a long path must beat a
    // scattered match in a short one. An absolute length term inverts this.
    const longGood = score("index", "a/very/deeply/nested/path/to/index.ts");
    const shortBad = score("index", "i-n-d-e-x.ts");
    expect(longGood).toBeGreaterThan(shortBad);
  });

  it("scores the first character no better than the boundary bonus", () => {
    // A `prevMatchIdx = -1` sentinel tested as `=== i - 1` made every match at
    // offset 0 collect a spurious "consecutive" bonus it had not earned.
    const atStart = score("a", "abc");
    const midWord = score("b", "abc");
    const perfect = score("a", "a");
    expect(atStart).toBeGreaterThan(midWord);
    expect(atStart).toBeLessThanOrEqual(perfect);
  });
});

describe("multi-term queries", () => {
  it("requires every term to match by default", () => {
    expect(scoreText("foo bar", "foo/baz.ts")).toBeNull();
    expect(scoreText("foo baz", "foo/baz.ts")).not.toBeNull();
  });

  it("matches terms out of order", () => {
    expect(scoreText("baz foo", "foo/baz.ts")).not.toBeNull();
  });

  it("does not let two terms claim the same characters", () => {
    // Independent per-term matching let a repeated term double its score
    // against one set of characters.
    const once = scoreText("test", "tests/test_x.py");
    const twice = scoreText("test test", "tests/test_x.py");
    expect(once).not.toBeNull();
    // Two "test" terms need two distinct occurrences; this string has them,
    // so it matches — but cannot reuse the first occurrence's characters.
    if (twice) {
      expect(twice.best.indices.length).toBeGreaterThan(
        once!.best.indices.length,
      );
    }
  });

  it("fails when the text has fewer occurrences than repeated terms", () => {
    expect(scoreText("ab ab", "xxabxx")).toBeNull();
  });

  it("keeps multi-term scores comparable to single-term scores", () => {
    // Summing per-term scores makes a two-term match numerically incomparable
    // to a one-term match, which breaks any weighting or blending on top.
    const single = scoreText("foo", "foo/bar.ts")!;
    const multi = scoreText("foo bar", "foo/bar.ts")!;
    expect(multi.score).toBeLessThanOrEqual(1);
    expect(single.score).toBeLessThanOrEqual(1);
  });

  it("can be told not to require every term", () => {
    const result = scoreCandidate(
      "foo nope",
      [{ key: "text", text: "foo/bar.ts", weight: 1 }],
      { requireAllTerms: false },
    );
    expect(result).not.toBeNull();
  });

  it("returns sorted, deduplicated indices", () => {
    const result = scoreText("bar foo", "foo/bar.ts")!;
    const idx = result.best.indices;
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(new Set(idx).size).toBe(idx.length);
  });
});

describe("multi-field candidates", () => {
  const fields = (name: string, path: string) => [
    { key: "name", text: name, weight: 1 },
    { key: "path", text: path, weight: 0.6 },
  ];

  it("reports which field matched best", () => {
    const result = scoreCandidate("utils", fields("utils.ts", "a/b/utils.ts"))!;
    expect(result.best.key).toBe("name");
  });

  it("falls back to a lower-weighted field when the best does not match", () => {
    const result = scoreCandidate(
      "components",
      fields("utils.ts", "ui/components/utils.ts"),
    )!;
    expect(result.best.key).toBe("path");
  });

  it("prefers a name match over an equally good path-only match", () => {
    const nameMatch = scoreCandidate(
      "utils",
      fields("utils.ts", "a/b/utils.ts"),
    )!;
    const pathOnly = scoreCandidate(
      "components",
      fields("utils.ts", "ui/components/utils.ts"),
    )!;
    expect(nameMatch.score).toBeGreaterThan(pathOnly.score);
  });

  it("lets a secondary field add only a little", () => {
    // Matching weakly in several fields must not outrank matching well in the
    // field that counts.
    const both = scoreCandidate("ab", [
      { key: "name", text: "zzabzz", weight: 1 },
      { key: "path", text: "zzabzz", weight: 0.6 },
    ])!;
    const onlyBest = scoreCandidate("ab", [
      { key: "name", text: "zzabzz", weight: 1 },
    ])!;
    expect(both.score).toBeGreaterThan(onlyBest.score);
    expect(both.score - onlyBest.score).toBeLessThan(0.15);
  });

  it("cannot exceed a perfect single-field score by stacking fields", () => {
    const stacked = scoreCandidate("ab", [
      { key: "name", text: "ab", weight: 1 },
      { key: "path", text: "ab", weight: 0.6 },
      { key: "keywords", text: "ab", weight: 0.4 },
    ])!;
    expect(stacked.score).toBeLessThanOrEqual(1);
  });

  it("returns every field that matched, best first", () => {
    const result = scoreCandidate("ab", [
      { key: "name", text: "zzab", weight: 1 },
      { key: "path", text: "ab", weight: 0.6 },
    ])!;
    expect(result.hits.length).toBe(2);
    expect(result.hits[0].key).toBe(result.best.key);
  });

  it("distributes terms across fields", () => {
    // "admin" only appears in the path, "opts" only in the filename. Requiring
    // both terms to land in one field forces this onto the lower-weighted
    // path alone, and it loses to noise that happens to contain both.
    const target = scoreCandidate(
      "admin opts",
      fields("options.py", "django/contrib/admin/options.py"),
    );
    const noise = scoreCandidate(
      "admin opts",
      fields(
        "suppress_base_options_command.py",
        "tests/admin_scripts/management/commands/suppress_base_options_command.py",
      ),
    );
    expect(target).not.toBeNull();
    expect(noise).not.toBeNull();
    expect(target!.score).toBeGreaterThan(noise!.score);
  });

  it("still requires every term to match somewhere", () => {
    expect(
      scoreCandidate("admin nope", fields("options.py", "admin/options.py")),
    ).toBeNull();
  });

  it("skips empty fields", () => {
    const result = scoreCandidate("ab", [
      { key: "name", text: "", weight: 1 },
      { key: "path", text: "ab", weight: 0.6 },
    ])!;
    expect(result.hits.length).toBe(1);
    expect(result.best.key).toBe("path");
  });

  it("indices are offsets into their own field", () => {
    const result = scoreCandidate("utils", [
      { key: "name", text: "utils.ts", weight: 1 },
      { key: "path", text: "a/b/utils.ts", weight: 0.6 },
    ])!;
    const name = result.hits.find((h) => h.key === "name")!;
    const path = result.hits.find((h) => h.key === "path")!;
    expect(name.indices[0]).toBe(0);
    expect(path.indices[0]).toBe(4);
  });
});

describe("boost", () => {
  it("scales the score multiplicatively", () => {
    const base = scoreText("ab", "abc")!;
    const boosted = scoreText("ab", "abc", { boost: 0.2 })!;
    expect(boosted.score).toBeCloseTo(base.score * 1.2, 6);
  });

  // An additive bonus inverts the ordering whenever base scores are close;
  // a multiplicative one keeps the bump proportional to match quality.
  it("does not let a boosted poor match beat an unboosted strong one", () => {
    const strong = scoreText("index", "index.ts")!;
    const weak = scoreText("index", "i-n-d-e-x-file.ts", { boost: 0.2 })!;
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("breaks ties between equally good matches", () => {
    const plain = scoreText("ab", "ab/c.ts")!;
    const boosted = scoreText("ab", "ab/d.ts", { boost: 0.2 })!;
    expect(boosted.score).toBeGreaterThan(plain.score);
  });
});

describe("minScore", () => {
  it("drops results at or below the cutoff", () => {
    const result = scoreText("abc", "abc");
    expect(result).not.toBeNull();
    expect(scoreText("abc", "abc", { minScore: 1 })).toBeNull();
  });
});

describe("unicode", () => {
  // Whole-string toLowerCase() is not length-preserving: 'İ' lowercases to two
  // code units, desynchronizing every index after it from the original text.
  it("keeps indices aligned with the original text", () => {
    const text = "İstanbul";
    const result = scoreText("stan", text);
    expect(result).not.toBeNull();
    const idx = result!.best.indices;
    const matched = idx.map((i) => text[i]).join("");
    expect(matched).toBe("stan");
  });

  it("matches text containing astral characters", () => {
    const text = "🎉 release notes";
    const result = scoreText("release", text);
    expect(result).not.toBeNull();
    const idx = result!.best.indices;
    expect(text.slice(idx[0], idx[idx.length - 1] + 1)).toBe("release");
  });
});

describe("performance", () => {
  // The recursive matcher was exponential in repeated query characters; a
  // 13-character query against 60 identical characters ran for minutes.
  it("handles pathologically repetitive input", () => {
    const text = "ts".repeat(40);
    const start = performance.now();
    const result = scoreText("tstststst", text);
    const elapsed = performance.now() - start;
    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(50);
  });

  it("scores a large candidate set within budget", () => {
    // Roughly Django's tracked-file count and path shape. The previous
    // implementation took ~100ms for "tests" and ~660ms for "tstst" here,
    // synchronously, on every keystroke.
    const paths: string[] = [];
    for (let i = 0; i < 7000; i++) {
      paths.push(
        `tests/migrations/test_app_${i}/submodule/test_migration_${i}.py`,
      );
    }

    for (const query of ["tests", "tstst", "teststest", "migration"]) {
      const start = performance.now();
      for (const path of paths) {
        scoreCandidate(query, [
          {
            key: "name",
            text: path.slice(path.lastIndexOf("/") + 1),
            weight: 1,
          },
          { key: "path", text: path, weight: 0.6 },
        ]);
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(300);
    }
  });
});
