/**
 * Git operations wrapper.
 * Ported from Python human_review/git.py
 */

import { execSync } from "node:child_process";

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

/**
 * Run a git command and return stdout.
 * Throws GitError on non-zero exit code.
 */
function runGit(args: string[], cwd: string): string {
  try {
    return execSync(["git", ...args].join(" "), {
      cwd,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
    });
  } catch (err: unknown) {
    const error = err as { stderr?: string };
    throw new GitError(`git ${args.join(" ")} failed: ${error.stderr?.trim() || "unknown error"}`);
  }
}

/**
 * Get the git repository root directory.
 */
export function gitRoot(cwd: string): string {
  return runGit(["rev-parse", "--show-toplevel"], cwd).trim();
}

/**
 * Get the git common dir (shared across worktrees).
 */
export function gitCommonDir(cwd: string): string {
  return runGit(["rev-parse", "--git-common-dir"], cwd).trim();
}

/**
 * Get the current branch name, or null if detached HEAD.
 */
export function gitCurrentBranch(cwd: string): string | null {
  try {
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Get the default branch (main or master).
 */
export function gitDefaultBranch(cwd: string): string {
  try {
    runGit(["rev-parse", "--verify", "main"], cwd);
    return "main";
  } catch {
    // Fall through
  }

  try {
    runGit(["rev-parse", "--verify", "master"], cwd);
    return "master";
  } catch {
    // Fall through
  }

  return "main";
}

/**
 * Get the merge base (common ancestor) of two refs.
 */
export function gitMergeBase(ref1: string, ref2: string, cwd: string): string {
  return runGit(["merge-base", ref1, ref2], cwd).trim();
}

/**
 * Get diff output between base and compare (or working tree if compare is null).
 * Uses -U0 for zero context lines, giving exact change boundaries and stable hashes.
 */
export function gitDiff(base: string, compare: string | null, cwd: string): string {
  if (compare === null) {
    // Working tree comparison
    return runGit(["diff", base, "-p", "-U0"], cwd);
  } else {
    // Branch comparison - use three dots for changes since common ancestor
    return runGit(["diff", `${base}...${compare}`, "-p", "-U0"], cwd);
  }
}

/**
 * Get diff name-status output showing file changes.
 */
export function gitDiffNameStatus(base: string, compare: string | null, cwd: string): string {
  if (compare === null) {
    return runGit(["diff", base, "--name-status"], cwd);
  } else {
    return runGit(["diff", `${base}...${compare}`, "--name-status"], cwd);
  }
}

/**
 * Get list of untracked files.
 */
export function gitUntrackedFiles(cwd: string): string[] {
  const output = runGit(["ls-files", "--others", "--exclude-standard"], cwd);
  return output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
}

/**
 * Check if a git ref exists.
 */
export function gitRefExists(ref: string, cwd: string): boolean {
  try {
    runGit(["rev-parse", "--verify", ref], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get diff output for a specific file against working tree.
 * Uses -U0 for zero context lines. Forces a/ and b/ prefixes for git apply compatibility.
 */
export function gitDiffFile(filePath: string, base: string | null, cwd: string): string {
  if (base !== null) {
    return runGit(["diff", "-p", "-U0", "--src-prefix=a/", "--dst-prefix=b/", base, "--", filePath], cwd);
  } else {
    return runGit(["diff", "-p", "-U0", "--src-prefix=a/", "--dst-prefix=b/", "--", filePath], cwd);
  }
}

/**
 * Apply a patch to the index (staging area).
 */
export function gitApplyPatch(patchContent: string, cwd: string): void {
  // Write patch to temp file and apply
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");

  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `human-review-patch-${Date.now()}.patch`);

  try {
    fs.writeFileSync(tempFile, patchContent);
    runGit(["apply", "--cached", tempFile], cwd);
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}
