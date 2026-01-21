import { execSync } from "node:child_process";
import { logError } from "../logger";
import type { CliDiffOutput } from "../types";

export class CliProvider {
	constructor(private workspaceRoot: string) {}

	/**
	 * Execute CLI command and return parsed JSON output
	 */
	private exec<T>(args: string[]): T {
		const command = `pullapprove-review ${args.join(" ")}`;

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
		const command = `pullapprove-review ${args.join(" ")}`;

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
	 * Mark a hunk as reviewed
	 */
	markHunk(path: string, hash: string): void {
		this.execVoid(["mark", `${path}:${hash}`]);
	}

	/**
	 * Unmark a hunk (mark as unreviewed)
	 */
	unmarkHunk(path: string, hash: string): void {
		this.execVoid(["unmark", `${path}:${hash}`]);
	}

	/**
	 * Mark all hunks in a file as reviewed
	 */
	markFile(path: string): void {
		this.execVoid(["mark", path]);
	}

	/**
	 * Unmark all hunks in a file
	 */
	unmarkFile(path: string): void {
		this.execVoid(["unmark", path]);
	}

	/**
	 * Set the current comparison
	 */
	setComparison(comparison: string): void {
		this.execVoid(["compare", comparison]);
	}
}
