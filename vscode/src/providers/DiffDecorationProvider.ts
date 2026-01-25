import * as vscode from "vscode";
import type { DiffHunk, HunkWithStatus } from "../types";
import { getRelativePath } from "../utils";
import type { FileTreeProvider } from "./FileTreeProvider";
import type { GitProvider } from "./GitProvider";

export class DiffDecorationProvider {
  // Separate decorations for first line (icon) vs continuation (bar)
  // Reviewed (manually approved) - green checkmark
  private reviewedIconType: vscode.TextEditorDecorationType;
  private reviewedBarType: vscode.TextEditorDecorationType;
  // Trusted (approved via label matching) - blue shield
  private trustedIconType: vscode.TextEditorDecorationType;
  private trustedBarType: vscode.TextEditorDecorationType;
  // Unreviewed - yellow eye
  private unreviewedIconType: vscode.TextEditorDecorationType;
  private unreviewedBarType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    private gitProvider: GitProvider,
    private fileTreeProvider: FileTreeProvider,
  ) {
    // Reviewed hunks (manually approved): checkmark icon for first line, bar for rest
    this.reviewedIconType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "reviewed-icon.svg"),
      gutterIconSize: "contain",
    });
    this.reviewedBarType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "reviewed-bar.svg"),
      gutterIconSize: "contain",
    });

    // Trusted hunks (approved via trust list): shield icon for first line, bar for rest
    this.trustedIconType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "trusted-icon.svg"),
      gutterIconSize: "contain",
    });
    this.trustedBarType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "trusted-bar.svg"),
      gutterIconSize: "contain",
    });

    // Unreviewed hunks: eye icon for first line, bar for rest, plus overview ruler highlight
    this.unreviewedIconType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "unreviewed-icon.svg"),
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("list.warningForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.unreviewedBarType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "unreviewed-bar.svg"),
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("list.warningForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Listen for editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor);
        }
      }),
    );

    // Listen for document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          this.updateDecorations(editor);
        }
      }),
    );

    // Initial update for all visible editors
    for (const editor of vscode.window.visibleTextEditors) {
      this.updateDecorations(editor);
    }
  }

  async refresh(): Promise<void> {
    // Update all visible editors (important for diff views which have two editors)
    for (const editor of vscode.window.visibleTextEditors) {
      await this.updateDecorations(editor);
    }
  }

  private async updateDecorations(editor: vscode.TextEditor): Promise<void> {
    // Check if editor decorations are enabled
    const config = vscode.workspace.getConfiguration("human-review");
    const showDecorations = config.get<boolean>("showEditorDecorations", true);
    if (!showDecorations) {
      this.clearDecorations(editor);
      return;
    }

    const comparison = this.fileTreeProvider.getCurrentComparison();
    if (!comparison) {
      this.clearDecorations(editor);
      return;
    }

    const workspaceRoot = this.gitProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      this.clearDecorations(editor);
      return;
    }

    // Get relative path from document URI
    const relativePath = getRelativePath(editor.document.uri, workspaceRoot);
    if (!relativePath) {
      this.clearDecorations(editor);
      return;
    }

    // Find the file in our tracked files
    const file = this.fileTreeProvider.getFiles().find((f) => f.relativePath === relativePath);
    if (!file || file.hunks.length === 0) {
      this.clearDecorations(editor);
      return;
    }

    const reviewedIconRanges: vscode.Range[] = [];
    const reviewedBarRanges: vscode.Range[] = [];
    const trustedIconRanges: vscode.Range[] = [];
    const trustedBarRanges: vscode.Range[] = [];
    const unreviewedIconRanges: vscode.Range[] = [];
    const unreviewedBarRanges: vscode.Range[] = [];

    // Check if we're on the old (left) or new (right) side of the diff
    const isOldSide = this.isOldSideOfDiff(editor.document.uri);

    for (const hunk of file.hunks as HunkWithStatus[]) {
      // Get appropriate line ranges based on which side of diff we're viewing
      const changedLineRanges = isOldSide
        ? this.getDeletedLineRanges(hunk)
        : this.getAddedLineRanges(hunk);

      if (changedLineRanges.length > 0) {
        // Priority: reviewed (manual) > trusted > unreviewed
        if (hunk.reviewed) {
          // Manually approved - green checkmark
          reviewedIconRanges.push(changedLineRanges[0]);
          reviewedBarRanges.push(...changedLineRanges.slice(1));
        } else if (hunk.trusted) {
          // Approved via trust list - blue shield
          trustedIconRanges.push(changedLineRanges[0]);
          trustedBarRanges.push(...changedLineRanges.slice(1));
        } else {
          // Not approved - yellow eye
          unreviewedIconRanges.push(changedLineRanges[0]);
          unreviewedBarRanges.push(...changedLineRanges.slice(1));
        }
      }
    }

    editor.setDecorations(this.reviewedIconType, reviewedIconRanges);
    editor.setDecorations(this.reviewedBarType, reviewedBarRanges);
    editor.setDecorations(this.trustedIconType, trustedIconRanges);
    editor.setDecorations(this.trustedBarType, trustedBarRanges);
    editor.setDecorations(this.unreviewedIconType, unreviewedIconRanges);
    editor.setDecorations(this.unreviewedBarType, unreviewedBarRanges);
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.reviewedIconType, []);
    editor.setDecorations(this.reviewedBarType, []);
    editor.setDecorations(this.trustedIconType, []);
    editor.setDecorations(this.trustedBarType, []);
    editor.setDecorations(this.unreviewedIconType, []);
    editor.setDecorations(this.unreviewedBarType, []);
  }

  // Get line ranges for added lines (right side of diff)
  // Parse the hunk content to find actual positions of + lines
  private getAddedLineRanges(hunk: DiffHunk): vscode.Range[] {
    const ranges: vscode.Range[] = [];
    const lines = hunk.content.split("\n");

    // Track current line in the new file
    let newLineNum = hunk.startLine;

    for (const line of lines) {
      // Skip header, empty lines, and metadata (like "\ No newline at end of file")
      if (!line || line.startsWith("@@") || line.startsWith("\\")) continue;

      if (line.startsWith("+")) {
        // Added line - mark it and increment new line counter
        const lineIndex = newLineNum - 1;
        ranges.push(new vscode.Range(lineIndex, 0, lineIndex, Number.MAX_SAFE_INTEGER));
        newLineNum++;
      } else if (line.startsWith("-")) {
        // Deleted line - doesn't exist in new file, don't increment
      } else if (line.startsWith(" ")) {
        // Context line (starts with space) - exists in both, increment new line counter
        newLineNum++;
      }
      // Ignore any other lines (shouldn't happen with -U0)
    }

    return ranges;
  }

  // Get line ranges for deleted lines (left side of diff)
  // Parse the hunk content to find actual positions of - lines
  private getDeletedLineRanges(hunk: DiffHunk): vscode.Range[] {
    const ranges: vscode.Range[] = [];

    // Parse old start line from hunk header: @@ -oldStart,count +newStart,count @@
    const headerMatch = hunk.header.match(/@@ -(\d+)(?:,(\d+))?/);
    if (!headerMatch) return ranges;

    const oldStart = Number.parseInt(headerMatch[1], 10);
    const lines = hunk.content.split("\n");

    // Track current line in the old file
    let oldLineNum = oldStart;

    for (const line of lines) {
      // Skip header, empty lines, and metadata (like "\ No newline at end of file")
      if (!line || line.startsWith("@@") || line.startsWith("\\")) continue;

      if (line.startsWith("-")) {
        // Deleted line - mark it and increment old line counter
        const lineIndex = oldLineNum - 1;
        ranges.push(new vscode.Range(lineIndex, 0, lineIndex, Number.MAX_SAFE_INTEGER));
        oldLineNum++;
      } else if (line.startsWith("+")) {
        // Added line - doesn't exist in old file, don't increment
      } else if (line.startsWith(" ")) {
        // Context line (starts with space) - exists in both, increment old line counter
        oldLineNum++;
      }
      // Ignore any other lines (shouldn't happen with -U0)
    }

    return ranges;
  }

  // Check if this is the left (old) side of a diff
  private isOldSideOfDiff(uri: vscode.Uri): boolean {
    if (uri.scheme !== "git") return false;
    try {
      const query = JSON.parse(uri.query);
      // The old side has a ref (commit/branch), the new side is usually the working tree
      return !!query.ref;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.reviewedIconType.dispose();
    this.reviewedBarType.dispose();
    this.trustedIconType.dispose();
    this.trustedBarType.dispose();
    this.unreviewedIconType.dispose();
    this.unreviewedBarType.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
