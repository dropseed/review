import { describe, it, expect } from "vitest";
import { matchesPathGlob, getFilesByGlob, compileGlob } from "./glob";
import type { DiffHunk } from "../types";

describe("matchesPathGlob", () => {
  it("matches a bare name against the basename (any depth)", () => {
    expect(matchesPathGlob("src/deep/index.ts", "index.ts")).toBe(true);
    expect(matchesPathGlob("index.ts", "index.ts")).toBe(true);
    expect(matchesPathGlob("src/index.tsx", "index.ts")).toBe(false);
  });

  it("matches `*` within the basename across any depth", () => {
    expect(matchesPathGlob("src/deep/foo.test.ts", "*.test.ts")).toBe(true);
    expect(matchesPathGlob("foo.test.ts", "*.test.ts")).toBe(true);
    expect(matchesPathGlob("foo.ts", "*.test.ts")).toBe(false);
  });

  it("does not let basename `*` cross slashes implicitly", () => {
    // No slash in pattern → basename match, so directories are irrelevant.
    expect(matchesPathGlob("a/b/c/x.snap", "*.snap")).toBe(true);
  });

  it("matches full path when the pattern contains a slash", () => {
    expect(matchesPathGlob("src/api/client.ts", "src/*")).toBe(false); // * stops at /
    expect(matchesPathGlob("src/client.ts", "src/*")).toBe(true);
    expect(matchesPathGlob("src/api/client.ts", "src/*/client.ts")).toBe(true);
  });

  it("supports `**` globstar across directories", () => {
    expect(matchesPathGlob("src/a/b/client.ts", "src/**/client.ts")).toBe(true);
    expect(matchesPathGlob("src/client.ts", "src/**/client.ts")).toBe(true);
    expect(matchesPathGlob("src/a/b/x.py", "src/**/*.py")).toBe(true);
    expect(matchesPathGlob("lib/a/x.py", "src/**/*.py")).toBe(false);
    expect(matchesPathGlob("src/a/b", "src/**")).toBe(true);
  });

  it("supports `?` for a single non-slash character", () => {
    expect(matchesPathGlob("v1.ts", "v?.ts")).toBe(true);
    expect(matchesPathGlob("v12.ts", "v?.ts")).toBe(false);
  });

  it("treats regex-significant characters literally", () => {
    expect(matchesPathGlob("a+b.ts", "a+b.ts")).toBe(true);
    expect(matchesPathGlob("axb.ts", "a+b.ts")).toBe(false);
    expect(matchesPathGlob("file.test.ts", "file.test.ts")).toBe(true);
    expect(matchesPathGlob("fileXtestXts", "file.test.ts")).toBe(false);
  });

  it("never matches an empty/whitespace pattern", () => {
    expect(matchesPathGlob("anything.ts", "")).toBe(false);
    expect(matchesPathGlob("anything.ts", "   ")).toBe(false);
  });
});

describe("getFilesByGlob", () => {
  const hunk = (id: string, filePath: string): DiffHunk =>
    ({ id, filePath }) as DiffHunk;

  const hunks = [
    hunk("1", "src/a/index.ts"),
    hunk("2", "src/a/index.ts"),
    hunk("3", "src/b/index.ts"),
    hunk("4", "src/b/foo.test.ts"),
    hunk("5", "docs/readme.md"),
  ];

  it("groups all matching hunks by file path", () => {
    const result = getFilesByGlob(hunks, "index.ts");
    expect([...result.keys()]).toEqual(["src/a/index.ts", "src/b/index.ts"]);
    expect(result.get("src/a/index.ts")!.map((h) => h.id)).toEqual(["1", "2"]);
  });

  it("matches by extension glob", () => {
    const result = getFilesByGlob(hunks, "*.test.ts");
    expect([...result.keys()]).toEqual(["src/b/foo.test.ts"]);
  });

  it("returns empty for an empty pattern", () => {
    expect(getFilesByGlob(hunks, "").size).toBe(0);
  });
});

describe("compileGlob", () => {
  it("reuses one compiled matcher across paths", () => {
    const match = compileGlob("*.ts");
    expect(match("a.ts")).toBe(true);
    expect(match("a/b.ts")).toBe(true);
    expect(match("a.md")).toBe(false);
  });
});
