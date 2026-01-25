/**
 * System tests for human-review VS Code extension.
 *
 * These tests verify the core functionality works end-to-end
 * without mocking - they use real git operations on temp repos.
 *
 * Run with: npm test
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { test, describe, before, after } from "node:test";

// Import modules to test (these don't depend on VS Code)
import { hashContent, getHunkKey, parseHunkKey } from "../src/utils/hash";
import { parseDiffToHunks, parseNameStatus, createUntrackedHunk } from "../src/diff/parser";
import { gitDiff, gitDiffNameStatus, gitRoot, gitMergeBase } from "../src/git/operations";
import { patternMatchesGlob, patternsMatchTrustList, isLabelTrusted } from "../src/trust/matching";
import { TRUST_PATTERNS, getPattern, isValidPattern } from "../src/trust/patterns";
import { StateService } from "../src/state/StateService";
import { buildClassifyPrompt, buildDiffContent, getUnlabeledHunks } from "../src/classify/prompt";

// Helper to create a temp git repo for testing
function createTempRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "human-review-test-"));
  // Resolve symlinks (macOS /var -> /private/var)
  const realDir = fs.realpathSync(tmpDir);
  execSync("git init", { cwd: realDir });
  execSync('git config user.email "test@test.com"', { cwd: realDir });
  execSync('git config user.name "Test"', { cwd: realDir });
  // Disable GPG signing for test commits
  execSync("git config commit.gpgsign false", { cwd: realDir });
  return realDir;
}

function cleanupTempRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// Hash Tests
// ============================================================================

describe("Hash utilities", () => {
  test("hashContent returns 8-char hex string", () => {
    const hash = hashContent("hello world");
    assert.strictEqual(hash.length, 8);
    assert.match(hash, /^[a-f0-9]{8}$/);
  });

  test("hashContent is deterministic", () => {
    const hash1 = hashContent("test content");
    const hash2 = hashContent("test content");
    assert.strictEqual(hash1, hash2);
  });

  test("hashContent differs for different content", () => {
    const hash1 = hashContent("content A");
    const hash2 = hashContent("content B");
    assert.notStrictEqual(hash1, hash2);
  });

  test("getHunkKey combines path and hash", () => {
    const key = getHunkKey("src/foo.ts", "abc12345");
    assert.strictEqual(key, "src/foo.ts:abc12345");
  });

  test("parseHunkKey extracts path and hash", () => {
    const { filePath, hash } = parseHunkKey("src/foo.ts:abc12345");
    assert.strictEqual(filePath, "src/foo.ts");
    assert.strictEqual(hash, "abc12345");
  });

  test("parseHunkKey handles paths with colons", () => {
    const { filePath, hash } = parseHunkKey("C:/Users/foo/bar.ts:abc12345");
    assert.strictEqual(filePath, "C:/Users/foo/bar.ts");
    assert.strictEqual(hash, "abc12345");
  });
});

// ============================================================================
// Trust Pattern Tests
// ============================================================================

describe("Trust patterns", () => {
  test("TRUST_PATTERNS has expected patterns", () => {
    assert.ok(TRUST_PATTERNS["imports:added"]);
    assert.ok(TRUST_PATTERNS["formatting:whitespace"]);
    assert.ok(TRUST_PATTERNS["file:deleted"]);
  });

  test("getPattern returns pattern by ID", () => {
    const pattern = getPattern("imports:added");
    assert.ok(pattern);
    assert.strictEqual(pattern.id, "imports:added");
    assert.ok(pattern.description.length > 0);
  });

  test("isValidPattern accepts known patterns", () => {
    assert.strictEqual(isValidPattern("imports:added"), true);
    assert.strictEqual(isValidPattern("formatting:whitespace"), true);
  });

  test("isValidPattern accepts custom: patterns", () => {
    assert.strictEqual(isValidPattern("custom:my-pattern"), true);
    assert.strictEqual(isValidPattern("custom:anything"), true);
  });

  test("isValidPattern rejects unknown patterns", () => {
    assert.strictEqual(isValidPattern("unknown:pattern"), false);
    assert.strictEqual(isValidPattern("notapattern"), false);
  });
});

// ============================================================================
// Pattern Matching Tests
// ============================================================================

describe("Pattern matching", () => {
  test("exact match works", () => {
    assert.strictEqual(patternMatchesGlob("imports:added", "imports:added"), true);
    assert.strictEqual(patternMatchesGlob("imports:added", "imports:removed"), false);
  });

  test("wildcard suffix matches", () => {
    assert.strictEqual(patternMatchesGlob("imports:added", "imports:*"), true);
    assert.strictEqual(patternMatchesGlob("imports:removed", "imports:*"), true);
    assert.strictEqual(patternMatchesGlob("formatting:whitespace", "imports:*"), false);
  });

  test("wildcard prefix matches", () => {
    assert.strictEqual(patternMatchesGlob("imports:added", "*:added"), true);
    assert.strictEqual(patternMatchesGlob("types:added", "*:added"), true);
    assert.strictEqual(patternMatchesGlob("imports:removed", "*:added"), false);
  });

  test("patternsMatchTrustList with empty patterns", () => {
    const result = patternsMatchTrustList([], ["imports:*"]);
    assert.strictEqual(result.allTrusted, false);
    assert.deepStrictEqual(result.untrustedPatterns, []);
  });

  test("patternsMatchTrustList with all trusted", () => {
    const result = patternsMatchTrustList(["imports:added", "imports:removed"], ["imports:*"]);
    assert.strictEqual(result.allTrusted, true);
    assert.deepStrictEqual(result.untrustedPatterns, []);
  });

  test("patternsMatchTrustList with some untrusted", () => {
    const result = patternsMatchTrustList(["imports:added", "formatting:whitespace"], ["imports:*"]);
    assert.strictEqual(result.allTrusted, false);
    assert.deepStrictEqual(result.untrustedPatterns, ["formatting:whitespace"]);
  });

  test("isLabelTrusted works", () => {
    assert.strictEqual(isLabelTrusted("imports:added", ["imports:*"]), true);
    assert.strictEqual(isLabelTrusted("formatting:whitespace", ["imports:*"]), false);
    assert.strictEqual(isLabelTrusted("formatting:whitespace", ["imports:*", "formatting:*"]), true);
  });
});

// ============================================================================
// Git Operations Tests (requires real git repo)
// ============================================================================

describe("Git operations", () => {
  let tempRepo: string;

  before(() => {
    tempRepo = createTempRepo();
    // Create initial commit
    fs.writeFileSync(path.join(tempRepo, "file.txt"), "initial content\n");
    execSync("git add file.txt", { cwd: tempRepo });
    execSync('git commit -m "Initial commit"', { cwd: tempRepo });
  });

  after(() => {
    cleanupTempRepo(tempRepo);
  });

  test("gitRoot returns repo root", () => {
    const root = gitRoot(tempRepo);
    assert.strictEqual(root, tempRepo);
  });

  test("gitDiff returns empty for no changes", () => {
    const diff = gitDiff("HEAD", null, tempRepo);
    assert.strictEqual(diff.trim(), "");
  });

  test("gitDiff returns diff for working tree changes", () => {
    fs.writeFileSync(path.join(tempRepo, "file.txt"), "modified content\n");
    const diff = gitDiff("HEAD", null, tempRepo);
    assert.ok(diff.includes("diff --git"));
    assert.ok(diff.includes("-initial content"));
    assert.ok(diff.includes("+modified content"));
    // Restore
    fs.writeFileSync(path.join(tempRepo, "file.txt"), "initial content\n");
  });

  test("gitDiffNameStatus returns status for changes", () => {
    fs.writeFileSync(path.join(tempRepo, "file.txt"), "modified content\n");
    const status = gitDiffNameStatus("HEAD", null, tempRepo);
    assert.ok(status.includes("M"));
    assert.ok(status.includes("file.txt"));
    // Restore
    fs.writeFileSync(path.join(tempRepo, "file.txt"), "initial content\n");
  });
});

// ============================================================================
// Diff Parsing Tests
// ============================================================================

describe("Diff parsing", () => {
  test("parseNameStatus parses modified file", () => {
    const output = "M\tfile.txt\n";
    const result = parseNameStatus(output);
    assert.strictEqual(result.size, 1);
    const info = result.get("file.txt");
    assert.ok(info);
    assert.strictEqual(info.status, "modified");
    assert.strictEqual(info.oldPath, null);
  });

  test("parseNameStatus parses added file", () => {
    const output = "A\tnew-file.txt\n";
    const result = parseNameStatus(output);
    const info = result.get("new-file.txt");
    assert.ok(info);
    assert.strictEqual(info.status, "added");
  });

  test("parseNameStatus parses deleted file", () => {
    const output = "D\told-file.txt\n";
    const result = parseNameStatus(output);
    const info = result.get("old-file.txt");
    assert.ok(info);
    assert.strictEqual(info.status, "deleted");
  });

  test("parseNameStatus parses renamed file", () => {
    const output = "R100\told-name.txt\tnew-name.txt\n";
    const result = parseNameStatus(output);
    const info = result.get("new-name.txt");
    assert.ok(info);
    assert.strictEqual(info.status, "renamed");
    assert.strictEqual(info.oldPath, "old-name.txt");
  });

  test("parseDiffToHunks parses simple diff", () => {
    const diff = `diff --git a/file.txt b/file.txt
index abc1234..def5678 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old line
+new line
`;
    const files = parseDiffToHunks(diff);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].path, "file.txt");
    assert.strictEqual(files[0].hunks.length, 1);
    assert.strictEqual(files[0].hunks[0].startLine, 1);
    assert.strictEqual(files[0].hunks[0].endLine, 1);
    assert.ok(files[0].hunks[0].hash.length === 8);
  });

  test("parseDiffToHunks parses multiple hunks", () => {
    const diff = `diff --git a/file.txt b/file.txt
index abc1234..def5678 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old line 1
+new line 1
@@ -10 +10 @@
-old line 10
+new line 10
`;
    const files = parseDiffToHunks(diff);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].hunks.length, 2);
    assert.strictEqual(files[0].hunks[0].startLine, 1);
    assert.strictEqual(files[0].hunks[1].startLine, 10);
  });

  test("parseDiffToHunks uses file status map", () => {
    const diff = `diff --git a/file.txt b/file.txt
index abc1234..def5678 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
`;
    const statusMap = new Map([["file.txt", { status: "modified" as const, oldPath: null }]]);
    const files = parseDiffToHunks(diff, statusMap);
    assert.strictEqual(files[0].status, "modified");
  });

  test("createUntrackedHunk creates hunk for new file", () => {
    const hunk = createUntrackedHunk("new-file.ts", "file content");
    assert.strictEqual(hunk.filePath, "new-file.ts");
    assert.strictEqual(hunk.startLine, 1);
    assert.strictEqual(hunk.endLine, 1);
    assert.ok(hunk.hash.length === 8);
  });
});

// ============================================================================
// State Service Tests
// ============================================================================

describe("StateService", () => {
  let tempRepo: string;
  let stateService: StateService;

  before(() => {
    tempRepo = createTempRepo();
    // Create initial commit so git common dir exists
    fs.writeFileSync(path.join(tempRepo, "file.txt"), "content\n");
    execSync("git add file.txt", { cwd: tempRepo });
    execSync('git commit -m "Initial"', { cwd: tempRepo });

    stateService = StateService.create(tempRepo)!;
    assert.ok(stateService, "StateService should be created");
  });

  after(() => {
    cleanupTempRepo(tempRepo);
  });

  test("load returns empty state for new comparison", () => {
    const state = stateService.load("master..feature+working-tree");
    assert.deepStrictEqual(state.hunks, {});
    assert.deepStrictEqual(state.trust_label, []);
    assert.strictEqual(state.notes, "");
    assert.strictEqual(state.comparison.old, "master");
    assert.strictEqual(state.comparison.new, "feature");
    assert.strictEqual(state.comparison.working_tree, true);
  });

  test("save and load round-trips state", () => {
    const state = stateService.load("test..comparison");
    state.notes = "Test notes";
    state.trust_label = ["imports:*"];
    state.hunks["file.txt:abc12345"] = {
      label: ["imports:added"],
      reasoning: "Added import",
      approved_via: null,
      count: 1,
    };
    stateService.save(state);

    // Clear cache by creating new service
    const newService = StateService.create(tempRepo)!;
    const loaded = newService.load("test..comparison");

    assert.strictEqual(loaded.notes, "Test notes");
    assert.deepStrictEqual(loaded.trust_label, ["imports:*"]);
    assert.ok(loaded.hunks["file.txt:abc12345"]);
    assert.deepStrictEqual(loaded.hunks["file.txt:abc12345"].label, ["imports:added"]);
  });

  test("approveHunk sets approved_via", () => {
    stateService.approveHunk("approve..test", "file.txt:12345678");
    const state = stateService.load("approve..test");
    assert.strictEqual(state.hunks["file.txt:12345678"].approved_via, "review");
  });

  test("unapproveHunk clears approved_via", () => {
    stateService.approveHunk("unapprove..test", "file.txt:12345678");
    stateService.unapproveHunk("unapprove..test", "file.txt:12345678");
    const state = stateService.load("unapprove..test");
    assert.strictEqual(state.hunks["file.txt:12345678"].approved_via, null);
  });

  test("addTrustLabel and removeTrustLabel work", () => {
    stateService.addTrustLabel("trust..test", "imports:*");
    stateService.addTrustLabel("trust..test", "formatting:*");
    let labels = stateService.getTrustLabels("trust..test");
    assert.deepStrictEqual(labels, ["imports:*", "formatting:*"]);

    stateService.removeTrustLabel("trust..test", "imports:*");
    labels = stateService.getTrustLabels("trust..test");
    assert.deepStrictEqual(labels, ["formatting:*"]);
  });

  test("updateNotes and getNotes work", () => {
    stateService.updateNotes("notes..test", "My review notes");
    const notes = stateService.getNotes("notes..test");
    assert.strictEqual(notes, "My review notes");
  });

  test("setCurrentComparison and getCurrentComparison work", () => {
    stateService.setCurrentComparison("current..comparison");
    const current = stateService.getCurrentComparison();
    assert.strictEqual(current, "current..comparison");
  });

  test("setHunkClassification stores labels and reasoning", () => {
    stateService.setHunkClassification(
      "classify..test",
      "file.txt:abc12345",
      ["imports:added", "formatting:whitespace"],
      "Added import and fixed whitespace",
    );
    const classification = stateService.getHunkClassification("classify..test", "file.txt:abc12345");
    assert.ok(classification);
    assert.deepStrictEqual(classification.label, ["imports:added", "formatting:whitespace"]);
    assert.strictEqual(classification.reasoning, "Added import and fixed whitespace");
  });
});

// ============================================================================
// Classification Prompt Tests
// ============================================================================

describe("Classification prompts", () => {
  test("buildDiffContent formats hunks correctly", () => {
    const hunks = [
      {
        file: { path: "src/foo.ts", status: "modified" as const, old_path: null, hunks: [] },
        hunk: {
          filePath: "src/foo.ts",
          hash: "abc12345",
          header: "@@ -1 +1 @@",
          content: "-old\n+new",
          startLine: 1,
          endLine: 1,
        },
        hunkKey: "src/foo.ts:abc12345",
      },
    ];
    const content = buildDiffContent(hunks);
    assert.ok(content.includes("=== src/foo.ts:abc12345 ==="));
    assert.ok(content.includes("File: src/foo.ts (modified)"));
    assert.ok(content.includes("@@ -1 +1 @@"));
    assert.ok(content.includes("-old\n+new"));
  });

  test("buildClassifyPrompt includes pattern taxonomy", () => {
    const prompt = buildClassifyPrompt("test diff content");
    assert.ok(prompt.includes("imports:added"));
    assert.ok(prompt.includes("formatting:whitespace"));
    assert.ok(prompt.includes("test diff content"));
    assert.ok(prompt.includes("Return ONLY the JSON object"));
  });

  test("getUnlabeledHunks returns hunks without reasoning", () => {
    const files = [
      {
        path: "file.ts",
        status: "modified" as const,
        old_path: null,
        hunks: [
          { filePath: "file.ts", hash: "labeled1", header: "", content: "", startLine: 1, endLine: 1 },
          { filePath: "file.ts", hash: "unlabel1", header: "", content: "", startLine: 2, endLine: 2 },
        ],
      },
    ];
    const hunks = {
      "file.ts:labeled1": { reasoning: "Has reasoning" },
    };
    const unlabeled = getUnlabeledHunks(files, hunks);
    assert.strictEqual(unlabeled.length, 1);
    assert.strictEqual(unlabeled[0].hunkKey, "file.ts:unlabel1");
  });
});

// ============================================================================
// Integration Test - Full Workflow
// ============================================================================

describe("Integration: Full review workflow", () => {
  let tempRepo: string;
  let stateService: StateService;

  before(() => {
    tempRepo = createTempRepo();
    // Create initial commit
    fs.mkdirSync(path.join(tempRepo, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, "src/app.ts"), 'import { foo } from "bar";\n\nconst x = 1;\n');
    execSync("git add .", { cwd: tempRepo });
    execSync('git commit -m "Initial"', { cwd: tempRepo });

    stateService = StateService.create(tempRepo)!;
  });

  after(() => {
    cleanupTempRepo(tempRepo);
  });

  test("complete review workflow", () => {
    // 1. Make changes
    fs.writeFileSync(
      path.join(tempRepo, "src/app.ts"),
      'import { foo } from "bar";\nimport { baz } from "qux";\n\nconst x = 2;\n',
    );

    // 2. Get diff
    const diff = gitDiff("HEAD", null, tempRepo);
    assert.ok(diff.includes("+import { baz }"));

    // 3. Parse hunks
    const nameStatus = gitDiffNameStatus("HEAD", null, tempRepo);
    const statusMap = parseNameStatus(nameStatus);
    const files = parseDiffToHunks(diff, statusMap);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].hunks.length >= 1);

    // 4. Start a review
    const comparisonKey = "HEAD..HEAD+working-tree";
    stateService.setCurrentComparison(comparisonKey);

    // 5. Classify a hunk
    const hunkKey = getHunkKey(files[0].hunks[0].filePath, files[0].hunks[0].hash);
    stateService.setHunkClassification(comparisonKey, hunkKey, ["imports:added"], "Added baz import");

    // 6. Trust the pattern
    stateService.addTrustLabel(comparisonKey, "imports:*");

    // 7. Verify the hunk is trusted
    const state = stateService.load(comparisonKey);
    const hunkState = state.hunks[hunkKey];
    assert.ok(hunkState);
    assert.deepStrictEqual(hunkState.label, ["imports:added"]);
    const isTrusted = isLabelTrusted("imports:added", state.trust_label);
    assert.strictEqual(isTrusted, true);

    // 8. Add review notes
    stateService.updateNotes(comparisonKey, "Reviewed the import addition - looks good.");
    assert.strictEqual(stateService.getNotes(comparisonKey), "Reviewed the import addition - looks good.");

    // 9. Manually approve another hunk
    if (files[0].hunks.length > 1) {
      const hunk2Key = getHunkKey(files[0].hunks[1].filePath, files[0].hunks[1].hash);
      stateService.approveHunk(comparisonKey, hunk2Key);
      const updated = stateService.load(comparisonKey);
      assert.strictEqual(updated.hunks[hunk2Key].approved_via, "review");
    }
  });
});

console.log("\n✓ All system tests passed!\n");
