import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { DiffDecorationProvider } from "./DiffDecorationProvider";
import type { FileTreeProvider } from "./FileTreeProvider";
import type { GitProvider } from "./GitProvider";
import type { ReviewStateService } from "./ReviewStateService";

interface ComparisonSpec {
	type: "branch" | "working_tree";
	base?: string;
	compare?: string;
}

interface ReviewWebviewMessage {
	type:
		| "ready"
		| "selectComparison"
		| "updateNotes"
		| "copy"
		| "clear"
		| "selectRepository";
	spec?: ComparisonSpec; // From webview dropdown selection
	notes?: string;
	repoPath?: string;
}

export class ReviewViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "pullapprove-review.review";

	private view?: vscode.WebviewView;
	private decorationProvider?: DiffDecorationProvider;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly gitProvider: GitProvider,
		private readonly stateService: ReviewStateService,
		private readonly fileTreeProvider: FileTreeProvider,
	) {}

	setDecorationProvider(provider: DiffDecorationProvider): void {
		this.decorationProvider = provider;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
		};

		webviewView.webview.html = this.getHtmlForWebview();

		webviewView.webview.onDidReceiveMessage((message: ReviewWebviewMessage) =>
			this.handleMessage(message),
		);
	}

	private async handleMessage(message: ReviewWebviewMessage): Promise<void> {
		switch (message.type) {
			case "ready":
				this.loadRepositories();
				await this.loadBranches();
				await this.refreshNotes();
				break;

			case "selectRepository":
				if (message.repoPath) {
					this.gitProvider.selectRepository(message.repoPath);
					await this.loadBranches();
				}
				break;

			case "selectComparison":
				if (message.spec) {
					// Convert spec to CLI comparison string
					let comparison: string;
					if (message.spec.type === "working_tree" && message.spec.base) {
						// Working tree comparison: just the base branch
						comparison = message.spec.base;
					} else if (
						message.spec.type === "branch" &&
						message.spec.base &&
						message.spec.compare
					) {
						// Branch comparison: base..compare
						comparison = `${message.spec.base}..${message.spec.compare}`;
					} else {
						break;
					}
					// FileTreeProvider.selectComparison calls CLI to set comparison and get files
					await this.fileTreeProvider.selectComparison(comparison);
					await this.refreshNotes();
					await this.decorationProvider?.refresh();
				}
				break;

			case "updateNotes": {
				const comparison = this.fileTreeProvider.getCurrentComparison();
				if (comparison && message.notes !== undefined) {
					this.stateService.updateNotes(comparison, message.notes);
				}
				break;
			}

			case "copy":
				await this.copyAsMarkdown();
				break;

			case "clear":
				await this.clearReview();
				break;
		}
	}

	private async loadBranches(): Promise<void> {
		if (!this.gitProvider.hasRepository()) {
			this.postMessage({ type: "noRepository" });
			return;
		}

		const branches = await this.gitProvider.getBranches();
		const currentBranch = this.gitProvider.getCurrentBranch();

		this.postMessage({
			type: "branchesLoaded",
			branches,
			currentBranch,
		});
	}

	private loadRepositories(): void {
		const repos = this.gitProvider.getRepositories();
		const current = this.gitProvider.getWorkspaceRoot();
		this.postMessage({
			type: "repositoriesLoaded",
			repositories: repos,
			selectedRepo: current,
		});
	}

	public async onRepositoryReady(): Promise<void> {
		this.loadRepositories();
		await this.loadBranches();
	}

	public async refreshNotes(): Promise<void> {
		const comparison = this.fileTreeProvider.getCurrentComparison();
		if (!comparison) {
			this.postMessage({ type: "notesLoaded", notes: "" });
			return;
		}

		const notes = this.stateService.getNotes(comparison);
		this.postMessage({
			type: "notesLoaded",
			notes: notes,
		});
	}

	public addLineReference(
		filePath: string,
		lineNumber?: number,
		lineRange?: { start: number; end: number },
	): void {
		const workspaceRoot = this.gitProvider.getWorkspaceRoot();
		const relativePath = workspaceRoot
			? filePath.replace(`${workspaceRoot}/`, "")
			: filePath;

		let reference = relativePath;
		if (lineNumber !== undefined) {
			reference += `:${lineNumber}`;
		} else if (lineRange) {
			reference += `:${lineRange.start}-${lineRange.end}`;
		}

		this.postMessage({
			type: "referenceAdded",
			reference,
		});
	}

	public addFileReference(relativePath: string): void {
		this.postMessage({
			type: "referenceAdded",
			reference: relativePath,
		});
	}

	private async copyAsMarkdown(): Promise<void> {
		const comparison = this.fileTreeProvider.getCurrentComparison();
		if (!comparison) return;

		const notes = this.stateService.getNotes(comparison);
		const markdown = `# Review Notes\n\n${notes.trim() || "(No notes)"}`;
		await vscode.env.clipboard.writeText(markdown);

		// Notify webview that copy succeeded
		this.postMessage({ type: "copied" });
	}

	private async clearReview(): Promise<void> {
		const comparison = this.fileTreeProvider.getCurrentComparison();
		if (!comparison) return;

		// Only clear notes, not checkboxes
		this.stateService.updateNotes(comparison, "");
		await this.refreshNotes();
	}

	private postMessage(message: unknown): void {
		this.view?.webview.postMessage(message);
	}

	private getHtmlForWebview(): string {
		const nonce = this.getNonce();
		const htmlPath = path.join(
			this.extensionUri.fsPath,
			"media",
			"review.html",
		);
		const html = fs.readFileSync(htmlPath, "utf-8");
		return html.replace(/\{\{nonce\}\}/g, nonce);
	}

	private getNonce(): string {
		let text = "";
		const possible =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
