/**
 * State service for managing review state persistence.
 * Ported from Python human_review/state.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { Comparison, HunkState, ReviewState } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export class StateService {
  private static readonly STATE_DIR_NAME = "human-review";
  private static readonly REVIEWS_DIR_NAME = "reviews";
  private static readonly CURRENT_FILE_NAME = "current";

  private cache: Map<string, ReviewState> = new Map();

  constructor(
    private readonly repoRoot: string,
    private readonly gitCommonDir: string,
  ) {}

  /**
   * Create a StateService for the current workspace.
   */
  static create(workspaceRoot: string): StateService | null {
    try {
      const gitCommonDir = execSync("git rev-parse --git-common-dir", {
        cwd: workspaceRoot,
        encoding: "utf-8",
      }).trim();

      // Resolve relative path
      const resolvedCommonDir = path.isAbsolute(gitCommonDir)
        ? gitCommonDir
        : path.resolve(workspaceRoot, gitCommonDir);

      return new StateService(workspaceRoot, resolvedCommonDir);
    } catch {
      return null;
    }
  }

  private get stateDir(): string {
    return path.join(this.gitCommonDir, StateService.STATE_DIR_NAME, StateService.REVIEWS_DIR_NAME);
  }

  private get currentFile(): string {
    return path.join(this.gitCommonDir, StateService.STATE_DIR_NAME, StateService.CURRENT_FILE_NAME);
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /**
   * Convert comparison key to filesystem-safe filename.
   */
  static sanitizeKey(comparisonKey: string): string {
    return comparisonKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  /**
   * Create a Comparison from base and compare refs.
   */
  static makeComparison(base: string, compare: string, workingTree: boolean): Comparison {
    const key = workingTree ? `${base}..${compare}+working-tree` : `${base}..${compare}`;
    return {
      old: base,
      new: compare,
      working_tree: workingTree,
      key,
    };
  }

  /**
   * Parse a comparison key string into a Comparison object.
   */
  private parseComparisonKey(comparisonKey: string): Comparison {
    let workingTree = false;
    let keyToParse = comparisonKey;

    if (comparisonKey.endsWith("+working-tree")) {
      workingTree = true;
      keyToParse = comparisonKey.slice(0, -13);
    }

    if (!keyToParse.includes("..")) {
      throw new Error(`Invalid comparison key: ${comparisonKey}`);
    }

    const [old, newRef] = keyToParse.split("..", 2);
    return {
      old,
      new: newRef,
      working_tree: workingTree,
      key: comparisonKey,
    };
  }

  private getFilePath(comparisonKey: string): string {
    const sanitized = StateService.sanitizeKey(comparisonKey);
    return path.join(this.stateDir, `${sanitized}.json`);
  }

  /**
   * Load state for a comparison key, creating empty if not exists.
   */
  load(comparisonKey: string): ReviewState {
    // Check cache
    const cached = this.cache.get(comparisonKey);
    if (cached) {
      return cached;
    }

    const filePath = this.getFilePath(comparisonKey);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const state = this.migrateState(data, comparisonKey);
        this.cache.set(comparisonKey, state);
        return state;
      } catch {
        // Fall through to create empty state
      }
    }

    // Return empty state
    const now = nowIso();
    const comparison = this.parseComparisonKey(comparisonKey);
    return {
      comparison,
      hunks: {},
      trust_label: [],
      notes: "",
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Migrate old state formats to current format.
   */
  private migrateState(data: Record<string, unknown>, comparisonKey: string): ReviewState {
    const now = nowIso();

    // Handle old format with comparisonKey (string) instead of comparison (dict)
    if ("comparisonKey" in data && !("comparison" in data)) {
      data.comparison = this.parseComparisonKey(data.comparisonKey as string);
      delete data.comparisonKey;
    }

    // Handle old format with reviewedHunks list instead of hunks dict
    if ("reviewedHunks" in data || "reviewed_hunks" in data) {
      const oldReviewed = (data.reviewedHunks || data.reviewed_hunks || []) as string[];
      const hunks = (data.hunks || {}) as Record<string, Partial<HunkState>>;
      for (const hunkKey of oldReviewed) {
        if (!(hunkKey in hunks)) {
          hunks[hunkKey] = { approved_via: "review" };
        } else {
          hunks[hunkKey].approved_via = "review";
        }
      }
      data.hunks = hunks;
      delete data.reviewedHunks;
      delete data.reviewed_hunks;
    }

    // Handle old classifications dict
    if ("classifications" in data) {
      const classifications = data.classifications as Record<string, { reason?: string }>;
      const hunks = (data.hunks || {}) as Record<string, Partial<HunkState>>;
      for (const [hunkKey, classification] of Object.entries(classifications)) {
        if (!(hunkKey in hunks)) {
          hunks[hunkKey] = {};
        }
        hunks[hunkKey].label = classification.reason ? [classification.reason] : [];
      }
      data.hunks = hunks;
      delete data.classifications;
    }

    // Migrate old fields in hunks
    const hunks = (data.hunks || {}) as Record<string, Record<string, unknown>>;
    for (const hunkData of Object.values(hunks)) {
      // Migrate old "reason" field to "label"
      if ("reason" in hunkData) {
        hunkData.label = hunkData.reason;
        delete hunkData.reason;
      }

      // Migrate old reviewed: bool to approved_via
      if ("reviewed" in hunkData && !("approved_via" in hunkData)) {
        if (hunkData.reviewed) {
          hunkData.approved_via = "review";
        } else {
          hunkData.approved_via = null;
        }
        delete hunkData.reviewed;
      }

      // Migrate reviewed_by to approved_via
      if ("reviewed_by" in hunkData) {
        if (!("approved_via" in hunkData)) {
          if (hunkData.reviewed_by === "agent") {
            hunkData.approved_via = null; // Trust is now computed
          } else if (hunkData.reviewed_by === "human") {
            hunkData.approved_via = "review";
          } else {
            hunkData.approved_via = null;
          }
        }
        delete hunkData.reviewed_by;
      }

      // Migrate old label to reasoning (label was free-form text)
      if ("label" in hunkData && !Array.isArray(hunkData.label)) {
        if (!("reasoning" in hunkData)) {
          hunkData.reasoning = hunkData.label;
        }
        delete hunkData.label;
      }

      // Migrate old "trust" field to "label"
      if ("trust" in hunkData) {
        hunkData.label = hunkData.trust;
        delete hunkData.trust;
      }

      // Ensure label is an array
      if (!("label" in hunkData)) {
        hunkData.label = [];
      }

      // Migrate old "expected_count" to "count"
      if ("expected_count" in hunkData) {
        hunkData.count = hunkData.expected_count;
        delete hunkData.expected_count;
      }

      // Convert approved_via: "trust" -> null (trust is now computed)
      if (hunkData.approved_via === "trust") {
        hunkData.approved_via = null;
      }

      // Drop old unused fields
      delete hunkData.suggested;
      delete hunkData.review;
      delete hunkData.trivial;
      delete hunkData.human;
    }

    // Ensure timestamps exist
    if (!("created_at" in data)) {
      data.created_at = now;
    }
    if (!("updated_at" in data)) {
      data.updated_at = now;
    }

    // Ensure comparison is valid
    if (!("comparison" in data)) {
      data.comparison = this.parseComparisonKey(comparisonKey);
    } else {
      // Migrate old comparison where new might be null
      const comp = data.comparison as Comparison;
      if (comp.new === null || comp.new === undefined) {
        comp.new = "HEAD";
      }
    }

    // Ensure required fields exist
    if (!("hunks" in data)) {
      data.hunks = {};
    }
    if (!("trust_label" in data)) {
      data.trust_label = [];
    }
    if (!("notes" in data)) {
      data.notes = "";
    }

    return data as unknown as ReviewState;
  }

  /**
   * Save state to disk.
   */
  save(state: ReviewState): void {
    state.updated_at = nowIso();
    this.cache.set(state.comparison.key, state);
    this.ensureDirectory();
    const filePath = this.getFilePath(state.comparison.key);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
  }

  /**
   * Clear state for a comparison key.
   */
  clear(comparisonKey: string): void {
    this.cache.delete(comparisonKey);
    const filePath = this.getFilePath(comparisonKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * Get the current comparison key.
   */
  getCurrentComparison(): string | null {
    if (fs.existsSync(this.currentFile)) {
      return fs.readFileSync(this.currentFile, "utf-8").trim() || null;
    }
    return null;
  }

  /**
   * Set the current comparison key.
   */
  setCurrentComparison(comparisonKey: string): void {
    this.ensureDirectory();
    fs.writeFileSync(this.currentFile, comparisonKey + "\n");
  }

  /**
   * Clear the current comparison.
   */
  clearCurrentComparison(): void {
    if (fs.existsSync(this.currentFile)) {
      fs.unlinkSync(this.currentFile);
    }
  }

  private getOrCreateHunk(state: ReviewState, hunkKey: string): HunkState {
    if (!(hunkKey in state.hunks)) {
      state.hunks[hunkKey] = {
        label: [],
        reasoning: null,
        approved_via: null,
        count: null,
      };
    }
    return state.hunks[hunkKey];
  }

  /**
   * Approve a hunk after manual review.
   */
  approveHunk(comparisonKey: string, hunkKey: string, count = 1): void {
    const state = this.load(comparisonKey);
    const hunk = this.getOrCreateHunk(state, hunkKey);
    if (hunk.approved_via === null) {
      hunk.approved_via = "review";
      hunk.count = count;
      this.save(state);
    }
  }

  /**
   * Remove approval from a hunk.
   */
  unapproveHunk(comparisonKey: string, hunkKey: string): void {
    const state = this.load(comparisonKey);
    if (hunkKey in state.hunks && state.hunks[hunkKey].approved_via !== null) {
      state.hunks[hunkKey].approved_via = null;
      this.save(state);
    }
  }

  /**
   * Check if a hunk is manually approved.
   */
  isHunkApproved(comparisonKey: string, hunkKey: string): boolean {
    const state = this.load(comparisonKey);
    const hunk = state.hunks[hunkKey];
    return hunk ? hunk.approved_via !== null : false;
  }

  /**
   * Update the notes for a comparison.
   */
  updateNotes(comparisonKey: string, notes: string): void {
    const state = this.load(comparisonKey);
    state.notes = notes;
    this.save(state);
  }

  /**
   * Append text to the notes for a comparison.
   */
  appendNotes(comparisonKey: string, text: string): void {
    const state = this.load(comparisonKey);
    if (state.notes) {
      state.notes = state.notes.trimEnd() + "\n\n" + text;
    } else {
      state.notes = text;
    }
    this.save(state);
  }

  /**
   * Get notes for a comparison.
   */
  getNotes(comparisonKey: string): string {
    const state = this.load(comparisonKey);
    return state.notes;
  }

  /**
   * Set label patterns and reasoning for a hunk.
   */
  setHunkClassification(
    comparisonKey: string,
    hunkKey: string,
    label: string[],
    reasoning: string,
    count: number | null = null,
  ): void {
    const state = this.load(comparisonKey);
    const hunk = this.getOrCreateHunk(state, hunkKey);
    hunk.label = label;
    hunk.reasoning = reasoning;
    if (count !== null) {
      hunk.count = count;
    }
    this.save(state);
  }

  /**
   * Set multiple hunk classifications at once.
   */
  setHunkClassifications(
    comparisonKey: string,
    classifications: Record<string, { label: string[]; reasoning: string }>,
  ): void {
    const state = this.load(comparisonKey);
    for (const [hunkKey, data] of Object.entries(classifications)) {
      const hunk = this.getOrCreateHunk(state, hunkKey);
      hunk.label = data.label;
      hunk.reasoning = data.reasoning;
    }
    this.save(state);
  }

  /**
   * Get hunk classification.
   */
  getHunkClassification(comparisonKey: string, hunkKey: string): { label: string[]; reasoning: string | null } | null {
    const state = this.load(comparisonKey);
    const hunk = state.hunks[hunkKey];
    if (!hunk) return null;
    return { label: hunk.label, reasoning: hunk.reasoning };
  }

  /**
   * Clear all classifications for a comparison.
   */
  clearClassifications(comparisonKey: string): void {
    const state = this.load(comparisonKey);
    for (const hunk of Object.values(state.hunks)) {
      hunk.label = [];
      hunk.reasoning = null;
    }
    this.save(state);
  }

  /**
   * Add a pattern to the review-level trust list.
   */
  addTrustLabel(comparisonKey: string, pattern: string): void {
    const state = this.load(comparisonKey);
    if (!state.trust_label.includes(pattern)) {
      state.trust_label.push(pattern);
      this.save(state);
    }
  }

  /**
   * Remove a pattern from the review-level trust list.
   */
  removeTrustLabel(comparisonKey: string, pattern: string): boolean {
    const state = this.load(comparisonKey);
    const index = state.trust_label.indexOf(pattern);
    if (index !== -1) {
      state.trust_label.splice(index, 1);
      this.save(state);
      return true;
    }
    return false;
  }

  /**
   * Get the review-level trust list.
   */
  getTrustLabels(comparisonKey: string): string[] {
    const state = this.load(comparisonKey);
    return [...state.trust_label];
  }

  /**
   * List all stored reviews.
   */
  listReviews(): Array<{ key: string; path: string; mtime: number }> {
    if (!fs.existsSync(this.stateDir)) {
      return [];
    }

    const files = fs.readdirSync(this.stateDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const filePath = path.join(this.stateDir, f);
      const stat = fs.statSync(filePath);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const key = data.comparison?.key || f.replace(".json", "");
        return { key, path: filePath, mtime: stat.mtimeMs };
      } catch {
        return { key: f.replace(".json", ""), path: filePath, mtime: stat.mtimeMs };
      }
    });
  }
}
