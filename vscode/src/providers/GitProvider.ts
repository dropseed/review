import * as path from "node:path";
import * as vscode from "vscode";
import type { GitAPI, GitExtension, Repository } from "../types";

export class GitProvider {
	private api: GitAPI | null = null;
	private repository: Repository | null = null;
	private onRepoChangeCallbacks: Array<() => void> = [];
	private onRepoStateChangeCallbacks: Array<() => void> = [];

	async initialize(): Promise<boolean> {
		console.log("[PullApprove] GitProvider initializing...");
		const gitExtension =
			vscode.extensions.getExtension<GitExtension>("vscode.git");
		if (!gitExtension) {
			console.log("[PullApprove] Git extension not found");
			return false;
		}

		console.log(
			"[PullApprove] Git extension found, isActive:",
			gitExtension.isActive,
		);
		const git = gitExtension.isActive
			? gitExtension.exports
			: await gitExtension.activate();
		console.log("[PullApprove] Git API obtained");

		this.api = git.getAPI(1);

		// Get first repository if available
		console.log(
			"[PullApprove] Found repositories:",
			this.api.repositories.length,
		);
		if (this.api.repositories.length > 0) {
			this.repository = this.api.repositories[0];
			console.log(
				"[PullApprove] Using repository:",
				this.repository.rootUri.fsPath,
			);
			this.subscribeToRepoChanges(this.repository);
		}

		// Listen for new repositories
		this.api.onDidOpenRepository((repo) => {
			if (!this.repository) {
				this.repository = repo;
				this.subscribeToRepoChanges(repo);
			}
			// Always notify when repos change so UI can update dropdown
			for (const cb of this.onRepoChangeCallbacks) {
				cb();
			}
		});

		return this.repository !== null;
	}

	private subscribeToRepoChanges(repo: Repository): void {
		try {
			// The git extension's Repository has an onDidChange event
			// that fires when the repository state changes
			if (typeof repo.onDidChange === "function") {
				repo.onDidChange(() => {
					for (const cb of this.onRepoStateChangeCallbacks) {
						cb();
					}
				});
			} else {
				console.warn(
					"[PullApprove] Repository.onDidChange not available, file watching disabled",
				);
			}
		} catch (err) {
			console.error("[PullApprove] Failed to subscribe to repo changes:", err);
		}
	}

	hasRepository(): boolean {
		return this.repository !== null;
	}

	onRepositoryChange(callback: () => void): void {
		this.onRepoChangeCallbacks.push(callback);
	}

	onRepositoryStateChange(callback: () => void): void {
		this.onRepoStateChangeCallbacks.push(callback);
	}

	async getBranches(): Promise<string[]> {
		if (!this.repository) return [];

		try {
			const localBranches = await this.repository.getBranches({
				remote: false,
			});
			const remoteBranches = await this.repository.getBranches({
				remote: true,
			});

			const branches: string[] = [];

			// Add local branches first
			for (const b of localBranches) {
				if (b.name) {
					branches.push(b.name);
				}
			}

			// Add remote branches (without origin/ prefix duplicates)
			for (const b of remoteBranches) {
				if (b.name && !branches.includes(b.name)) {
					branches.push(b.name);
				}
			}

			return branches;
		} catch (err) {
			console.error("Error getting branches:", err);
			return [];
		}
	}

	getCurrentBranch(): string | undefined {
		return this.repository?.state.HEAD?.name;
	}

	getWorkspaceRoot(): string | undefined {
		return this.repository?.rootUri.fsPath;
	}

	getRepositories(): Array<{ path: string; name: string }> {
		return (
			this.api?.repositories.map((r) => ({
				path: r.rootUri.fsPath,
				name: path.basename(r.rootUri.fsPath),
			})) || []
		);
	}

	selectRepository(repoPath: string): void {
		const repo = this.api?.repositories.find(
			(r) => r.rootUri.fsPath === repoPath,
		);
		if (repo && repo !== this.repository) {
			this.repository = repo;
			this.subscribeToRepoChanges(repo);
			for (const cb of this.onRepoChangeCallbacks) {
				cb();
			}
		}
	}
}
