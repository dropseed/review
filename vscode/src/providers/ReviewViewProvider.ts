import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { StateService } from "../state/StateService";
import type { DiffDecorationProvider } from "./DiffDecorationProvider";
import type { FileTreeProvider } from "./FileTreeProvider";
import type { GitProvider } from "./GitProvider";

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
    | "selectRepository"
    | "trustLabel"
    | "untrustLabel"
    | "classify"
    | "stageReviewed";
  spec?: ComparisonSpec;
  notes?: string;
  repoPath?: string;
  label?: string;
}

export class ReviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "human-review.review";

  private view?: vscode.WebviewView;
  private decorationProvider?: DiffDecorationProvider;
  private stateService: StateService | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly gitProvider: GitProvider,
    private readonly fileTreeProvider: FileTreeProvider,
  ) {}

  setDecorationProvider(provider: DiffDecorationProvider): void {
    this.decorationProvider = provider;
  }

  setStateService(service: StateService): void {
    this.stateService = service;
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
        await this.refreshLabels();
        break;

      case "selectRepository":
        if (message.repoPath) {
          this.gitProvider.selectRepository(message.repoPath);
          await this.loadBranches();
        }
        break;

      case "selectComparison":
        if (message.spec) {
          let comparison: string;
          if (message.spec.type === "working_tree" && message.spec.base) {
            // Working tree comparison: base..HEAD+working-tree
            comparison = `${message.spec.base}..HEAD+working-tree`;
          } else if (message.spec.type === "branch" && message.spec.base && message.spec.compare) {
            // Branch comparison: base..compare
            comparison = `${message.spec.base}..${message.spec.compare}`;
          } else {
            break;
          }
          await this.fileTreeProvider.selectComparison(comparison);
          await this.refreshNotes();
          await this.refreshLabels();
          await this.decorationProvider?.refresh();
        }
        break;

      case "updateNotes": {
        const comparison = this.fileTreeProvider.getCurrentComparison();
        if (comparison && message.notes !== undefined && this.stateService) {
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

      case "trustLabel":
        if (message.label) {
          await this.fileTreeProvider.trustLabel(message.label);
          await this.refreshLabels();
        }
        break;

      case "untrustLabel":
        if (message.label) {
          await this.fileTreeProvider.untrustLabel(message.label);
          await this.refreshLabels();
        }
        break;

      case "classify":
        this.postMessage({ type: "classifyStarted" });
        try {
          await this.fileTreeProvider.classify();
          await this.refreshLabels();
          await this.decorationProvider?.refresh();
          this.postMessage({ type: "classifyComplete" });
        } catch {
          this.postMessage({ type: "classifyFailed" });
        }
        break;

      case "stageReviewed":
        await this.stageReviewedFiles();
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
    if (!comparison || !this.stateService) {
      this.postMessage({ type: "notesLoaded", notes: "" });
      return;
    }

    const notes = this.stateService.getNotes(comparison);
    this.postMessage({
      type: "notesLoaded",
      notes: notes,
    });
  }

  public async refreshLabels(): Promise<void> {
    const labelsMap = this.fileTreeProvider.getLabelsWithCounts();
    const labels = Array.from(labelsMap.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        trusted: data.trusted,
      }))
      .sort((a, b) => b.count - a.count);

    const unclassifiedCount = this.fileTreeProvider.getUnclassifiedCount();

    this.postMessage({
      type: "labelsLoaded",
      labels,
      unclassifiedCount,
    });

    // Also send progress update
    this.refreshProgress();
  }

  public refreshProgress(): void {
    const files = this.fileTreeProvider.getFiles();
    let total = 0;
    let reviewed = 0;

    for (const file of files) {
      for (const hunk of file.hunks) {
        total++;
        if (hunk.approved) {
          reviewed++;
        }
      }
    }

    this.postMessage({
      type: "progressUpdate",
      total,
      reviewed,
    });
  }

  public addLineReference(
    filePath: string,
    lineNumber?: number,
    lineRange?: { start: number; end: number },
  ): void {
    const workspaceRoot = this.gitProvider.getWorkspaceRoot();
    const relativePath = workspaceRoot ? filePath.replace(`${workspaceRoot}/`, "") : filePath;

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
    if (!comparison || !this.stateService) return;

    const notes = this.stateService.getNotes(comparison);
    const markdown = `# Review Notes\n\n${notes.trim() || "(No notes)"}`;
    await vscode.env.clipboard.writeText(markdown);

    this.postMessage({ type: "copied" });
  }

  private async clearReview(): Promise<void> {
    const comparison = this.fileTreeProvider.getCurrentComparison();
    if (!comparison || !this.stateService) return;

    this.stateService.updateNotes(comparison, "");
    await this.refreshNotes();
  }

  private async stageReviewedFiles(): Promise<void> {
    // Staging is not implemented in the native version
    // The user should use VS Code's built-in git staging
    vscode.window.showInformationMessage("Use VS Code's Source Control view to stage changes");
  }

  private postMessage(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  private getHtmlForWebview(): string {
    const nonce = this.getNonce();
    const htmlPath = path.join(this.extensionUri.fsPath, "media", "review.html");
    const html = fs.readFileSync(htmlPath, "utf-8");
    return html.replace(/\{\{nonce\}\}/g, nonce);
  }

  private getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
