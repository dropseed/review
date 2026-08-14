import { describe, it, expect } from "vitest";
import type { DiffHunk, FileDiff, FileEntry, FilesDelta } from "../types";
import { buildFileDiff } from "../types";
import { mergeDeltaHunks, patchFileTree } from "./filesDelta";

function hunk(filePath: string, hash: string): DiffHunk {
  return {
    id: `${filePath}:${hash}`,
    filePath,
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1,
    content: hash,
    lines: [],
    contentHash: hash,
  };
}

function diffs(...entries: [string, string[]][]): Record<string, FileDiff> {
  return Object.fromEntries(
    entries.map(([path, hashes]) => [
      path,
      buildFileDiff(hashes.map((h) => hunk(path, h))),
    ]),
  );
}

function delta(files: FilesDelta["files"], ...hunks: DiffHunk[]): FilesDelta {
  return { files, hunks };
}

describe("mergeDeltaHunks", () => {
  it("replaces the delta's files and leaves every other file's object alone", () => {
    const prev = diffs(["a.ts", ["old"]], ["b.ts", ["untouched"]]);

    const merged = mergeDeltaHunks(
      prev,
      delta(
        [{ path: "a.ts", status: "modified", exists: true }],
        hunk("a.ts", "new"),
      ),
    );

    expect(merged.changed).toBe(true);
    expect(merged.filesByPath["a.ts"].hunks[0].id).toBe("a.ts:new");
    expect(merged.filesByPath["b.ts"]).toBe(prev["b.ts"]);
  });

  it("keeps the previous object when the file came back identical", () => {
    const prev = diffs(["a.ts", ["same"]]);

    const merged = mergeDeltaHunks(
      prev,
      delta(
        [{ path: "a.ts", status: "modified", exists: true }],
        hunk("a.ts", "same"),
      ),
    );

    expect(merged.changed).toBe(false);
    expect(merged.filesByPath["a.ts"]).toBe(prev["a.ts"]);
    expect(merged.addedHunkIds).toEqual([]);
  });

  it("drops a file the edit took back out of the comparison", () => {
    const prev = diffs(["a.ts", ["old"]], ["b.ts", ["keep"]]);

    const merged = mergeDeltaHunks(
      prev,
      // Reverted to base content: still on disk, no longer changed, no hunks.
      delta([{ path: "a.ts", status: undefined, exists: true }]),
    );

    expect(merged.changed).toBe(true);
    expect("a.ts" in merged.filesByPath).toBe(false);
    expect(merged.filesByPath["b.ts"]).toBe(prev["b.ts"]);
  });

  it("reports only genuinely new hunk ids so classification stays scoped", () => {
    const prev = diffs(["a.ts", ["one", "two"]]);

    const merged = mergeDeltaHunks(
      prev,
      delta(
        [{ path: "a.ts", status: "modified", exists: true }],
        hunk("a.ts", "one"),
        hunk("a.ts", "three"),
      ),
    );

    expect(merged.addedHunkIds).toEqual(["a.ts:three"]);
  });

  it("adds a file that wasn't in the diff before", () => {
    const merged = mergeDeltaHunks(
      {},
      delta(
        [{ path: "new.ts", status: "untracked", exists: true }],
        hunk("new.ts", "fresh"),
      ),
    );

    expect(merged.changed).toBe(true);
    expect(merged.addedHunkIds).toEqual(["new.ts:fresh"]);
  });

  it("is a no-op for a path it has never held and that has no hunks", () => {
    const prev = diffs(["a.ts", ["one"]]);

    const merged = mergeDeltaHunks(
      prev,
      delta([{ path: "notes.md", status: undefined, exists: true }]),
    );

    expect(merged.changed).toBe(false);
    expect(merged.filesByPath).toEqual(prev);
  });
});

function tree(): FileEntry[] {
  return [
    {
      name: "src",
      path: "src",
      isDirectory: true,
      children: [
        {
          name: "deep",
          path: "src/deep",
          isDirectory: true,
          children: [
            {
              name: "b.ts",
              path: "src/deep/b.ts",
              isDirectory: false,
              status: "modified",
            },
          ],
        },
        { name: "a.ts", path: "src/a.ts", isDirectory: false },
      ],
    },
    { name: "README.md", path: "README.md", isDirectory: false },
  ];
}

/** Every file path in the tree, in render order. */
function paths(entries: FileEntry[]): string[] {
  return entries.flatMap((e) =>
    e.isDirectory ? paths(e.children ?? []) : [e.path],
  );
}

function find(entries: FileEntry[], path: string): FileEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const hit = entry.children && find(entry.children, path);
    if (hit) return hit;
  }
  return undefined;
}

describe("patchFileTree", () => {
  it("marks a file the edit just made part of the comparison", () => {
    const before = tree();
    const { entries, changed } = patchFileTree(before, [
      { path: "src/a.ts", status: "modified", exists: true },
    ]);

    expect(changed).toBe(true);
    expect(find(entries, "src/a.ts")?.status).toBe("modified");
    // Untouched branches keep their identity.
    expect(find(entries, "src/deep")).toBe(find(before, "src/deep"));
  });

  it("clears the status of a file edited back to its base content", () => {
    const { entries, changed } = patchFileTree(tree(), [
      { path: "src/deep/b.ts", status: undefined, exists: true },
    ]);

    expect(changed).toBe(true);
    expect(find(entries, "src/deep/b.ts")?.status).toBeUndefined();
  });

  it("leaves the tree untouched when nothing about the file moved", () => {
    const before = tree();
    const { entries, changed } = patchFileTree(before, [
      { path: "src/deep/b.ts", status: "modified", exists: true },
      { path: "README.md", status: undefined, exists: true },
    ]);

    expect(changed).toBe(false);
    expect(entries).toBe(before);
  });

  it("inserts a new file in sorted position, creating the directories it needs", () => {
    const { entries, changed } = patchFileTree(tree(), [
      { path: "src/new/c.ts", status: "untracked", exists: true },
    ]);

    expect(changed).toBe(true);
    expect(find(entries, "src/new/c.ts")?.status).toBe("untracked");
    // Directories sort before files, and `deep` before `new`.
    expect(paths(entries)).toEqual([
      "src/deep/b.ts",
      "src/new/c.ts",
      "src/a.ts",
      "README.md",
    ]);
  });

  it("removes a file that is neither changed nor on disk, pruning the directory it emptied", () => {
    const { entries, changed } = patchFileTree(tree(), [
      { path: "src/deep/b.ts", status: undefined, exists: false },
    ]);

    expect(changed).toBe(true);
    expect(find(entries, "src/deep")).toBeUndefined();
    expect(paths(entries)).toEqual(["src/a.ts", "README.md"]);
  });

  it("keeps a deleted file that the comparison still covers", () => {
    // `git rm`-shaped: gone from disk, but the diff shows its removal.
    const { entries } = patchFileTree(tree(), [
      { path: "src/a.ts", status: "deleted", exists: false },
    ]);

    expect(find(entries, "src/a.ts")?.status).toBe("deleted");
  });

  it("carries a rename's old path onto the entry", () => {
    const { entries } = patchFileTree(tree(), [
      {
        path: "src/a.ts",
        status: "renamed",
        renamedFrom: "src/old.ts",
        exists: true,
      },
    ]);

    expect(find(entries, "src/a.ts")?.renamedFrom).toBe("src/old.ts");
  });
});
