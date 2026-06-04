import type { DiffHunk } from "../types";

/**
 * Glob/fnmatch-style matching of file paths, used by the "by filename"
 * approval flow so a user can target files by pattern instead of only by an
 * exact, literally-repeated basename.
 *
 * Semantics (chosen to be intuitive for filename matching):
 * - A pattern with no `/` is matched against the file's *basename* only, so
 *   `*.test.ts` matches `src/deep/foo.test.ts`.
 * - A pattern containing `/` is matched against the full relative path, so
 *   `src/**` only matches files under `src/`.
 * - `*`  matches any run of characters except `/`.
 * - `**` matches across directory separators; a trailing slash after it also
 *   matches zero directories.
 * - `?`  matches a single character except `/`.
 * - Every other character is matched literally.
 *
 * A pattern with no glob metacharacters is therefore an exact match (against
 * the basename or full path per the rule above), preserving the original
 * "approve every file literally named X" behavior.
 */
export function matchesPathGlob(filePath: string, pattern: string): boolean {
  return compileGlob(pattern)(filePath);
}

/**
 * Compile a glob pattern once into a reusable matcher. Prefer this over
 * {@link matchesPathGlob} when testing many paths against one pattern so the
 * regex is built a single time.
 */
export function compileGlob(pattern: string): (filePath: string) => boolean {
  const p = pattern.trim();
  if (!p) return () => false;
  const useBasename = !p.includes("/");
  const regex = globToRegExp(p);
  return (filePath: string) =>
    regex.test(useBasename ? basename(filePath) : filePath);
}

/**
 * Group hunks by file path, keeping only files whose path matches the glob
 * pattern. Returns a Map of filePath → DiffHunk[]. Drop-in replacement for the
 * old basename-only grouping.
 */
export function getFilesByGlob(
  hunks: DiffHunk[],
  pattern: string,
): Map<string, DiffHunk[]> {
  const map = new Map<string, DiffHunk[]>();
  const match = compileGlob(pattern);
  for (const hunk of hunks) {
    if (!match(hunk.filePath)) continue;
    const arr = map.get(hunk.filePath) ?? [];
    arr.push(hunk);
    map.set(hunk.filePath, arr);
  }
  return map;
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

/** Convert a glob pattern to an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**` matches across path separators; a trailing slash matches 0 dirs.
        i += 2;
        if (pattern[i] === "/") {
          re += "(?:.*/)?";
          i++;
        } else {
          re += ".*";
        }
      } else {
        // `*` — matches within a path segment.
        re += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else {
      re += escapeRegexChar(ch);
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeRegexChar(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}
