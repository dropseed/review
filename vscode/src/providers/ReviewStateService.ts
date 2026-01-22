import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ComparisonKey, SerializedReviewState } from "../types";

/**
 * Simplified state service that only manages notes.
 * Hunk marking/unmarking and comparison selection are handled by the CLI.
 */
export class ReviewStateService {
  private stateDir: string | null = null;

  constructor() {
    this.initStateDir();
  }

  private initStateDir(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      this.stateDir = path.join(workspaceFolder.uri.fsPath, ".human-review", "reviews");
      this.ensureDirectory();
    }
  }

  private get humanReviewDir(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return null;
    return path.join(workspaceFolder.uri.fsPath, ".human-review");
  }

  private get currentFile(): string | null {
    const dir = this.human - reviewDir;
    if (!dir) return null;
    return path.join(dir, "current");
  }

  /**
   * Get the current comparison key from .human-review/current file.
   * Returns null if no comparison is set.
   */
  getCurrentComparison(): string | null {
    const currentPath = this.currentFile;
    if (!currentPath || !fs.existsSync(currentPath)) {
      return null;
    }
    try {
      return fs.readFileSync(currentPath, "utf-8").trim() || null;
    } catch {
      return null;
    }
  }

  private ensureDirectory(): void {
    if (!this.stateDir) return;

    const humanReviewDir = path.dirname(this.stateDir);

    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }

    // Create .gitignore in human-review dir to ignore itself
    const gitignorePath = path.join(humanReviewDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "*\n");
    }
  }

  private sanitizeKey(comparisonKey: string): string {
    // Replace special characters that aren't filesystem-safe
    return comparisonKey.replace(/[^a-zA-Z0-9.+-]/g, "_");
  }

  /**
   * Parse a comparison string into a structured ComparisonKey.
   * Formats:
   *   "master" -> working tree comparison against master
   *   "master..feature" -> branch comparison
   *   "master..feature+" -> branch comparison including working tree
   */
  private parseComparisonKey(comparisonKey: string): ComparisonKey {
    const workingTree = comparisonKey.endsWith("+");
    const keyWithoutPlus = workingTree ? comparisonKey.slice(0, -1) : comparisonKey;

    if (keyWithoutPlus.includes("..")) {
      const [old, newRef] = keyWithoutPlus.split("..");
      return {
        old,
        new: newRef || null,
        working_tree: workingTree || !newRef,
        key: comparisonKey,
      };
    }

    // Simple format: just a branch name means compare to working tree
    return {
      old: keyWithoutPlus,
      new: null,
      working_tree: true,
      key: comparisonKey,
    };
  }

  private getFilePath(comparisonKey: string): string | null {
    if (!this.stateDir) return null;
    const sanitized = this.sanitizeKey(comparisonKey);
    return path.join(this.stateDir, `${sanitized}.json`);
  }

  /**
   * Get notes for a comparison.
   */
  getNotes(comparisonKey: string): string {
    const filePath = this.getFilePath(comparisonKey);
    if (!filePath || !fs.existsSync(filePath)) {
      return "";
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const data: SerializedReviewState = JSON.parse(content);
      return data.notes || "";
    } catch (err) {
      console.error("Error reading notes:", err);
      return "";
    }
  }

  /**
   * Update notes for a comparison.
   * Preserves existing hunks state.
   */
  updateNotes(comparisonKey: string, notes: string): void {
    const filePath = this.getFilePath(comparisonKey);
    if (!filePath) return;

    const now = new Date().toISOString();
    const comparison = this.parseComparisonKey(comparisonKey);

    // Read existing state to preserve hunks and created_at
    let existingData: SerializedReviewState = {
      comparison,
      hunks: {},
      notes: "",
      created_at: now,
      updated_at: now,
    };

    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        existingData = JSON.parse(content);
        // Update comparison in case format changed
        existingData.comparison = comparison;
        // Ensure hunks exists (might be missing from old format)
        if (!existingData.hunks) {
          existingData.hunks = {};
        }
      } catch {
        // Use defaults if file is corrupt
      }
    }

    // Update notes and timestamp
    existingData.notes = notes;
    existingData.updated_at = now;

    try {
      this.ensureDirectory();
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
    } catch (err) {
      console.error("Error saving notes:", err);
    }
  }
}
