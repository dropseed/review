import * as vscode from "vscode";
import { initLogger, logError } from "./logger";
import { CliProvider } from "./providers/CliProvider";
import { DiffDecorationProvider } from "./providers/DiffDecorationProvider";
import { type FileTreeItem, FileTreeProvider } from "./providers/FileTreeProvider";
import { GitProvider } from "./providers/GitProvider";
import { ReviewStateService } from "./providers/ReviewStateService";
import { ReviewViewProvider } from "./providers/ReviewViewProvider";
import type { DiffHunk } from "./types";
import { getRelativePath } from "./utils";

// Extended hunk type that includes review status from CLI
interface HunkWithStatus extends DiffHunk {
  reviewed: boolean;
}

// Helper to find the hunk at the current cursor position in a diff view
function getCurrentHunkInfo(
  gitProvider: GitProvider,
  fileTreeProvider: FileTreeProvider,
): { relativePath: string; hunk: HunkWithStatus } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const workspaceRoot = gitProvider.getWorkspaceRoot();
  if (!workspaceRoot) return null;

  const relativePath = getRelativePath(editor.document.uri, workspaceRoot);
  if (!relativePath) return null;

  // Find the file
  const file = fileTreeProvider.getFiles().find((f) => f.relativePath === relativePath);
  if (!file) return null;

  // Find the hunk that contains the current cursor position
  const line = editor.selection.active.line + 1;
  const hunk = file.hunks.find((h) => line >= h.startLine && line <= h.endLine);

  // If no hunk found by line range, and there's only one hunk, use it
  // (handles delete-only hunks where cursor might be on left side)
  if (!hunk && file.hunks.length === 1) {
    return { relativePath, hunk: file.hunks[0] };
  }

  if (!hunk) return null;

  return { relativePath, hunk };
}

// Helper to find all hunks that overlap with the current selection
function getSelectedHunksInfo(
  gitProvider: GitProvider,
  fileTreeProvider: FileTreeProvider,
): { relativePath: string; hunks: HunkWithStatus[] } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const workspaceRoot = gitProvider.getWorkspaceRoot();
  if (!workspaceRoot) return null;

  const relativePath = getRelativePath(editor.document.uri, workspaceRoot);
  if (!relativePath) return null;

  // Find the file
  const file = fileTreeProvider.getFiles().find((f) => f.relativePath === relativePath);
  if (!file) return null;

  // Get selection range (1-indexed to match hunk lines)
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;

  // Find all hunks that overlap with the selection
  const hunks = file.hunks.filter((h) => h.startLine <= endLine && h.endLine >= startLine);

  if (hunks.length === 0) return null;

  return { relativePath, hunks };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogger();

  // Get workspace folder first (independent of git)
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }
  const workspaceRoot = workspaceFolder.uri.fsPath;

  // Initialize services
  const gitProvider = new GitProvider();
  const stateService = new ReviewStateService();
  const cliProvider = new CliProvider(workspaceRoot);

  // Create providers (don't wait for git - CLI will handle git operations)
  const fileTreeProvider = new FileTreeProvider(gitProvider, cliProvider);

  await gitProvider.initialize();

  const reviewViewProvider = new ReviewViewProvider(
    context.extensionUri,
    gitProvider,
    stateService,
    fileTreeProvider,
  );

  // Create decoration provider for visual hunk status in diffs
  const decorationProvider = new DiffDecorationProvider(
    context.extensionUri,
    gitProvider,
    fileTreeProvider,
  );

  // Wire up decoration provider to review view for refresh on comparison change
  reviewViewProvider.setDecorationProvider(decorationProvider);

  // Initial load - try to refresh from CLI (in case there's an existing comparison)
  fileTreeProvider.refresh();

  // Listen for repository becoming available
  gitProvider.onRepositoryChange(() => {
    reviewViewProvider.onRepositoryReady();
    fileTreeProvider.refresh();
  });

  // Register tree view
  const treeView = vscode.window.createTreeView("human-review.files", {
    treeDataProvider: fileTreeProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });

  // Auto-open diff when single file is selected (preserves single-click behavior)
  treeView.onDidChangeSelection((e) => {
    if (e.selection.length === 1) {
      const item = e.selection[0];
      if (item.file) {
        vscode.commands.executeCommand(
          "human-review.openDiff",
          item.file.relativePath,
          item.file.status,
          undefined, // lineNumber
          item.file.oldPath,
        );
      }
    }
  });

  // Watch for git repository changes and refresh tree + branches (debounced)
  // Uses VS Code's git extension events instead of file watchers for efficiency
  let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
  const debouncedRefresh = () => {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      fileTreeProvider.refresh();
      reviewViewProvider.onRepositoryReady(); // Reload branches when state changes
    }, 500);
  };

  gitProvider.onRepositoryStateChange(debouncedRefresh);

  // Watch for file system changes (supplements git extension events which may not fire for all changes)
  // Exclude directories that would cause noise or feedback loops
  const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, false, false);
  const shouldIgnore = (uri: vscode.Uri) => {
    const path = uri.fsPath;
    return (
      path.includes("/.git/") ||
      path.includes("/node_modules/") ||
      path.includes("/.human-review/") ||
      path.includes("/.vscode/pullapprove/")
    );
  };
  watcher.onDidChange((uri) => !shouldIgnore(uri) && debouncedRefresh());
  watcher.onDidCreate((uri) => !shouldIgnore(uri) && debouncedRefresh());
  watcher.onDidDelete((uri) => !shouldIgnore(uri) && debouncedRefresh());
  context.subscriptions.push(watcher);

  // Watch for changes to .human-review/current file (for CLI sync)
  // When the CLI changes the current comparison, refresh VSCode's view
  const currentFileWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.human-review/current",
    false,
    false,
    false,
  );
  const handleCurrentFileChange = () => {
    // Reload branches which will pick up the new current comparison
    reviewViewProvider.onRepositoryReady();
    fileTreeProvider.refresh();
    decorationProvider.refresh();
  };
  currentFileWatcher.onDidChange(handleCurrentFileChange);
  currentFileWatcher.onDidCreate(handleCurrentFileChange);
  currentFileWatcher.onDidDelete(handleCurrentFileChange);
  context.subscriptions.push(currentFileWatcher);

  // Watch for changes to review state files (for CLI sync)
  // When the CLI marks hunks or edits notes, refresh the UI
  const reviewStateWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.human-review/reviews/*.json",
    false,
    false,
    false,
  );
  let reviewStateRefreshTimeout: ReturnType<typeof setTimeout> | undefined;
  const handleReviewStateChange = () => {
    // Debounce to avoid multiple rapid refreshes
    if (reviewStateRefreshTimeout) clearTimeout(reviewStateRefreshTimeout);
    reviewStateRefreshTimeout = setTimeout(async () => {
      fileTreeProvider.refresh();
      await reviewViewProvider.refreshNotes();
      await decorationProvider.refresh();
    }, 100);
  };
  reviewStateWatcher.onDidChange(handleReviewStateChange);
  reviewStateWatcher.onDidCreate(handleReviewStateChange);
  reviewStateWatcher.onDidDelete(handleReviewStateChange);
  context.subscriptions.push(reviewStateWatcher);

  // Register webview provider
  try {
    const disposable = vscode.window.registerWebviewViewProvider(
      ReviewViewProvider.viewType,
      reviewViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(disposable);
  } catch (err: unknown) {
    // Ignore "already registered" error - this can happen during reload
    // when VSCode doesn't fully unload the previous extension instance
    const message = (err as Error)?.message || "";
    if (!message.includes("already registered")) {
      logError("Failed to register webview provider", err);
    }
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("human-review.refresh", async () => {
      fileTreeProvider.refresh();
      await reviewViewProvider.refreshNotes();
      await decorationProvider.refresh();
    }),

    vscode.commands.registerCommand("human-review.toggleEditorDecorations", async () => {
      const config = vscode.workspace.getConfiguration("human-review");
      const current = config.get<boolean>("showEditorDecorations", true);
      await config.update("showEditorDecorations", !current, true);
      await decorationProvider.refresh();
    }),

    vscode.commands.registerCommand("human-review.enableEditorDecorations", async () => {
      const config = vscode.workspace.getConfiguration("human-review");
      await config.update("showEditorDecorations", true, true);
      await decorationProvider.refresh();
    }),

    vscode.commands.registerCommand("human-review.disableEditorDecorations", async () => {
      const config = vscode.workspace.getConfiguration("human-review");
      await config.update("showEditorDecorations", false, true);
      await decorationProvider.refresh();
    }),

    // Context menu commands to mark/unmark current hunk based on cursor position
    vscode.commands.registerCommand("human-review.markCurrentHunkReviewed", async () => {
      const hunkInfo = getCurrentHunkInfo(gitProvider, fileTreeProvider);
      if (hunkInfo) {
        await fileTreeProvider.setHunkReviewed(hunkInfo.relativePath, hunkInfo.hunk.hash, true);
        await decorationProvider.refresh();
      }
    }),

    vscode.commands.registerCommand("human-review.unmarkCurrentHunkReviewed", async () => {
      const hunkInfo = getCurrentHunkInfo(gitProvider, fileTreeProvider);
      if (hunkInfo) {
        await fileTreeProvider.setHunkReviewed(hunkInfo.relativePath, hunkInfo.hunk.hash, false);
        await decorationProvider.refresh();
      }
    }),

    // Commands to mark/unmark all hunks within the current selection
    vscode.commands.registerCommand("human-review.markSelectedRangesReviewed", async () => {
      const info = getSelectedHunksInfo(gitProvider, fileTreeProvider);
      if (info) {
        for (const hunk of info.hunks) {
          await fileTreeProvider.setHunkReviewed(info.relativePath, hunk.hash, true);
        }
        await decorationProvider.refresh();
      }
    }),

    vscode.commands.registerCommand("human-review.unmarkSelectedRangesReviewed", async () => {
      const info = getSelectedHunksInfo(gitProvider, fileTreeProvider);
      if (info) {
        for (const hunk of info.hunks) {
          await fileTreeProvider.setHunkReviewed(info.relativePath, hunk.hash, false);
        }
        await decorationProvider.refresh();
      }
    }),

    vscode.commands.registerCommand("human-review.markReviewed", async (item: FileTreeItem) => {
      // Support multi-select: use selection if multiple items, otherwise just the clicked item
      const items = treeView.selection.length > 1 ? treeView.selection : item ? [item] : [];
      for (const selectedItem of items) {
        if (selectedItem.file) {
          await fileTreeProvider.setFileReviewed(selectedItem.file.relativePath, true);
        } else if (selectedItem.nodePath) {
          await fileTreeProvider.setFolderReviewed(selectedItem.nodePath, true);
        }
      }
      await decorationProvider.refresh();
    }),

    vscode.commands.registerCommand("human-review.unmarkReviewed", async (item: FileTreeItem) => {
      // Support multi-select: use selection if multiple items, otherwise just the clicked item
      const items = treeView.selection.length > 1 ? treeView.selection : item ? [item] : [];
      for (const selectedItem of items) {
        if (selectedItem.file) {
          await fileTreeProvider.setFileReviewed(selectedItem.file.relativePath, false);
        } else if (selectedItem.nodePath) {
          await fileTreeProvider.setFolderReviewed(selectedItem.nodePath, false);
        }
      }
      await decorationProvider.refresh();
    }),

    vscode.commands.registerCommand("human-review.markAllReviewed", async () => {
      await fileTreeProvider.markAllReviewed();
      await decorationProvider.refresh();
    }),

    vscode.commands.registerCommand("human-review.clearAllReviewed", async () => {
      await fileTreeProvider.clearAllReviewed();
      await decorationProvider.refresh();
    }),

    vscode.commands.registerCommand("human-review.openFile", async (item: FileTreeItem) => {
      const wsRoot = gitProvider.getWorkspaceRoot();
      if (!wsRoot || !item.file) return;

      const uri = vscode.Uri.file(`${wsRoot}/${item.file.relativePath}`);
      await vscode.commands.executeCommand("vscode.open", uri);
    }),

    vscode.commands.registerCommand("human-review.revealInExplorer", async (item: FileTreeItem) => {
      const wsRoot = gitProvider.getWorkspaceRoot();
      if (!wsRoot || !item.file) return;

      const uri = vscode.Uri.file(`${wsRoot}/${item.file.relativePath}`);
      await vscode.commands.executeCommand("revealInExplorer", uri);
    }),

    vscode.commands.registerCommand(
      "human-review.openDiff",
      async (
        arg: string | FileTreeItem,
        status?: string,
        lineNumber?: number,
        oldPathArg?: string,
      ) => {
        const wsRoot = gitProvider.getWorkspaceRoot();
        if (!wsRoot) return;

        // Handle both string (from click) and TreeItem (from context menu)
        let relativePath: string;
        let fileStatus: string | undefined;
        let oldPath: string | undefined;
        let scrollToLine: number | undefined;
        if (typeof arg === "string") {
          relativePath = arg;
          fileStatus = status;
          scrollToLine = lineNumber;
          oldPath = oldPathArg;
        } else {
          if (!arg.file) return;
          relativePath = arg.file.relativePath;
          fileStatus = arg.file.status;
          oldPath = arg.file.oldPath;
        }

        const filePath = `${wsRoot}/${relativePath}`;
        const filename = relativePath.split("/").pop() || relativePath;
        const comparison = fileTreeProvider.getCurrentComparison();

        // Parse comparison to get base and compare refs
        let baseRef: string | undefined;
        let compareRef: string | undefined;
        let isWorkingTree = false;

        if (comparison) {
          if (comparison.includes("..")) {
            const parts = comparison.split("..");
            baseRef = parts[0];
            const rest = parts[1];
            if (rest.endsWith("+")) {
              // Working tree comparison
              isWorkingTree = true;
            } else {
              compareRef = rest;
            }
          } else {
            baseRef = comparison;
            isWorkingTree = true;
          }
        }

        // For added/untracked files, just open the file
        if (fileStatus === "added" || fileStatus === "untracked") {
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath));
          return;
        }

        // For deleted files, show the old version from git
        if (fileStatus === "deleted" && baseRef) {
          const baseUri = vscode.Uri.parse(
            `git:${filePath}?${JSON.stringify({ path: filePath, ref: baseRef })}`,
          );
          await vscode.commands.executeCommand("vscode.open", baseUri);
          return;
        }

        try {
          // For renamed files, use the old path for the base URI
          const baseFilePath = oldPath ? `${wsRoot}/${oldPath}` : filePath;

          if (isWorkingTree && baseRef) {
            const baseUri = vscode.Uri.parse(
              `git:${baseFilePath}?${JSON.stringify({ path: baseFilePath, ref: baseRef })}`,
            );
            const workingUri = vscode.Uri.file(filePath);

            await vscode.commands.executeCommand(
              "vscode.diff",
              baseUri,
              workingUri,
              `${filename} (${baseRef} ↔ Working Tree)`,
            );
          } else if (baseRef && compareRef) {
            const baseUri = vscode.Uri.parse(
              `git:${baseFilePath}?${JSON.stringify({ path: baseFilePath, ref: baseRef })}`,
            );
            const compareUri = vscode.Uri.parse(
              `git:${filePath}?${JSON.stringify({ path: filePath, ref: compareRef })}`,
            );

            await vscode.commands.executeCommand(
              "vscode.diff",
              baseUri,
              compareUri,
              `${filename} (${baseRef} ↔ ${compareRef})`,
            );
          } else {
            const uri = vscode.Uri.file(filePath);
            const headUri = vscode.Uri.parse(
              `git:${baseFilePath}?${JSON.stringify({ path: baseFilePath, ref: "HEAD" })}`,
            );

            await vscode.commands.executeCommand(
              "vscode.diff",
              headUri,
              uri,
              `${filename} (HEAD ↔ Working Tree)`,
            );
          }

          // Scroll to specific line if provided
          // Delay needed to allow diff editor to fully render before scrolling
          if (scrollToLine !== undefined) {
            setTimeout(() => {
              const editor = vscode.window.activeTextEditor;
              if (editor) {
                const position = new vscode.Position(scrollToLine - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                  new vscode.Range(position, position),
                  vscode.TextEditorRevealType.InCenter,
                );
              }
            }, 100);
          }
        } catch (err) {
          console.error("[HumanReview] Failed to open diff:", err);
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath));
        }
      },
    ),

    vscode.commands.registerCommand("human-review.addFileToNotes", (item: FileTreeItem) => {
      // Support multi-select: use selection if multiple items, otherwise just the clicked item
      const items = treeView.selection.length > 1 ? treeView.selection : [item];
      for (const selectedItem of items) {
        if (selectedItem?.file) {
          reviewViewProvider.addFileReference(selectedItem.file.relativePath);
        } else if (selectedItem?.nodePath) {
          reviewViewProvider.addFileReference(`${selectedItem.nodePath}/`);
        }
      }
    }),

    vscode.commands.registerCommand("human-review.addLineReference", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      if (editor.document.isUntitled) return;

      const selection = editor.selection;
      if (!selection.isEmpty) {
        // Use range if there's a selection
        const start = selection.start.line + 1;
        const end = selection.end.line + 1;
        reviewViewProvider.addLineReference(editor.document.uri.fsPath, undefined, { start, end });
      } else {
        // Single line
        const ln = selection.active.line + 1;
        reviewViewProvider.addLineReference(editor.document.uri.fsPath, ln);
      }
    }),

    vscode.commands.registerCommand("human-review.addSelectionReference", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      if (editor.document.isUntitled) return;

      const selection = editor.selection;
      if (selection.isEmpty) return;

      const start = selection.start.line + 1;
      const end = selection.end.line + 1;

      reviewViewProvider.addLineReference(editor.document.uri.fsPath, undefined, { start, end });
    }),

    treeView,
    decorationProvider,
  );
}

export function deactivate(): void {}
