import { execSync } from "node:child_process";
import { log, logError } from "../logger";
import type { CliDiffOutput, CliStatusOutput } from "../types";

export class CliProvider {
  constructor(private workspaceRoot: string) {}

  /**
   * Execute CLI command and return parsed JSON output
   */
  private exec<T>(args: string[]): T {
    const command = `human-review ${args.join(" ")}`;

    try {
      const output = execSync(command, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
      });
      return JSON.parse(output) as T;
    } catch (err: unknown) {
      const error = err as {
        status?: number;
        stderr?: string;
        stdout?: string;
        message?: string;
      };
      logError("CLI exec failed", {
        command,
        message: error.message,
        status: error.status,
        stderr: error.stderr,
      });
      throw err;
    }
  }

  /**
   * Execute CLI command without expecting output (for mark/unmark)
   */
  private execVoid(args: string[]): void {
    const command = `human-review ${args.join(" ")}`;

    try {
      execSync(command, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
      });
    } catch (err: unknown) {
      const error = err as {
        status?: number;
        stderr?: string;
        stdout?: string;
        message?: string;
      };
      logError("CLI execVoid failed", {
        command,
        message: error.message,
        status: error.status,
        stderr: error.stderr,
      });
      throw err;
    }
  }

  /**
   * Get changed files with hunks and review status
   */
  getChangedFiles(): CliDiffOutput {
    return this.exec<CliDiffOutput>(["diff", "--json"]);
  }

  /**
   * Get review status
   */
  getStatus(): CliStatusOutput {
    return this.exec<CliStatusOutput>(["status", "--json"]);
  }

  /**
   * Approve a hunk (mark as reviewed)
   */
  approveHunk(path: string, hash: string): void {
    this.execVoid(["approve", `${path}:${hash}`, "-q"]);
  }

  /**
   * Unapprove a hunk (mark as unreviewed)
   */
  unapproveHunk(path: string, hash: string): void {
    this.execVoid(["unapprove", `${path}:${hash}`, "-q"]);
  }

  /**
   * Approve all hunks in a file
   */
  approveFile(path: string): void {
    this.execVoid(["approve", path, "-q"]);
  }

  /**
   * Unapprove all hunks in a file
   */
  unapproveFile(path: string): void {
    this.execVoid(["unapprove", path, "-q"]);
  }

  /**
   * Add a pattern to the trust list
   */
  addTrust(pattern: string): void {
    this.execVoid(["trust", pattern, "-q"]);
  }

  /**
   * Remove a pattern from the trust list
   */
  removeTrust(pattern: string): void {
    this.execVoid(["untrust", pattern, "-q"]);
  }

  /**
   * Set the current comparison (start or switch to a review)
   */
  setComparison(comparison: string): void {
    // Parse comparison to determine if working tree
    let args: string[];
    let switchKey: string;

    if (comparison.includes("..")) {
      const [base, compare] = comparison.split("..");
      if (compare === "__working_tree__" || compare.endsWith("+")) {
        args = ["start", "--old", base, "--working-tree", "-q"];
        switchKey = `${base}..${base}+working-tree`;
      } else {
        args = ["start", "--old", base, "--new", compare, "-q"];
        switchKey = `${base}..${compare}`;
      }
    } else {
      // Just a base ref = working tree comparison
      args = ["start", "--old", comparison, "--working-tree", "-q"];
      switchKey = `${comparison}..${comparison}+working-tree`;
    }

    try {
      this.execVoid(args);
    } catch (err: unknown) {
      const error = err as { stderr?: string };
      // If review already exists, switch to it instead
      if (error.stderr?.includes("review already exists")) {
        this.execVoid(["switch", switchKey, "-q"]);
      } else {
        throw err;
      }
    }
  }

  /**
   * Switch to an existing review
   */
  switchComparison(comparison: string): void {
    this.execVoid(["switch", comparison, "-q"]);
  }

  /**
   * Run classification on unlabeled hunks
   */
  classify(): void {
    log("Running classify command");
    this.execVoid(["classify", "-q"]);
    log("Classify command completed");
  }
}
