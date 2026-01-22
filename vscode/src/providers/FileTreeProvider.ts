import * as vscode from "vscode";
import { logError } from "../logger";
import type { CliFile, CliHunk, DiffHunk } from "../types";
import type { CliProvider } from "./CliProvider";
import type { GitProvider } from "./GitProvider";

type SectionType = "reviewed" | "toReview";

// Internal file representation with hunks that include review status
interface ChangedFileWithStatus {
  path: string;
  absolutePath: string;
  relativePath: string;
  oldPath?: string;
  status: string;
  hunks: Array<DiffHunk & { reviewed: boolean }>;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: ChangedFileWithStatus;
}

export class FileTreeProvider implements vscode.TreeDataProvider<FileTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentComparison: string | null = null;
  private lastSetComparison: string | null = null; // Track what we set (to prevent feedback loops)
  private files: ChangedFileWithStatus[] = [];
  private reviewedTree: TreeNode | null = null;
  private toReviewTree: TreeNode | null = null;

  constructor(
    private gitProvider: GitProvider,
    private cliProvider: CliProvider,
  ) {}

  async selectComparison(comparison: string): Promise<void> {
    // Skip if comparison hasn't changed (prevents feedback loop with file watcher)
    // Compare against what we last set, not what CLI returned (format may differ)
    if (comparison === this.lastSetComparison) {
      return;
    }

    this.lastSetComparison = comparison;

    // Set the comparison via CLI
    this.cliProvider.setComparison(comparison);

    // Refresh data from CLI
    await this.refreshFromCli();
  }

  async refreshFromCli(): Promise<void> {
    try {
      const workspaceRoot = this.gitProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        this.files = [];
        this.currentComparison = null;
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      const cliOutput = this.cliProvider.getChangedFiles();
      this.currentComparison = cliOutput.comparison;

      // Convert CLI output to internal format
      this.files = cliOutput.files.map((f: CliFile) => ({
        path: `${workspaceRoot}/${f.path}`,
        absolutePath: `${workspaceRoot}/${f.path}`,
        relativePath: f.path,
        oldPath: f.old_path,
        status: f.status,
        hunks: f.hunks.map((h: CliHunk) => ({
          filePath: f.path,
          hash: h.hash,
          startLine: h.start_line,
          endLine: h.end_line,
          header: h.header,
          content: h.content,
          reviewed: h.reviewed,
        })),
      }));

      this.rebuildTrees();
      this._onDidChangeTreeData.fire(undefined);
    } catch (err) {
      logError("Failed to get files from CLI", err);
      this.files = [];
      this.currentComparison = null;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  private rebuildTrees(): void {
    // Files can appear in both sections based on hunk state
    const reviewedFiles = this.files.filter((f) => this.hasAnyReviewedHunk(f));
    const toReviewFiles = this.files.filter((f) => this.hasAnyUnreviewedHunk(f));

    this.reviewedTree = this.buildTree(reviewedFiles);
    this.toReviewTree = this.buildTree(toReviewFiles);
  }

  getCurrentComparison(): string | null {
    return this.currentComparison;
  }

  getFiles(): ChangedFileWithStatus[] {
    return this.files;
  }

  refresh(): void {
    this.refreshFromCli();
  }

  async setHunkReviewed(filePath: string, hunkHash: string, isReviewed: boolean): Promise<void> {
    if (!this.currentComparison) return;

    if (isReviewed) {
      this.cliProvider.markHunk(filePath, hunkHash);
    } else {
      this.cliProvider.unmarkHunk(filePath, hunkHash);
    }

    await this.refreshFromCli();
  }

  async setFileReviewed(relativePath: string, isReviewed: boolean): Promise<void> {
    if (!this.currentComparison) return;

    const file = this.files.find((f) => f.relativePath === relativePath);
    if (!file) return;

    // Mark/unmark all hunks in the file
    for (const hunk of file.hunks) {
      if (isReviewed) {
        this.cliProvider.markHunk(relativePath, hunk.hash);
      } else {
        this.cliProvider.unmarkHunk(relativePath, hunk.hash);
      }
    }

    await this.refreshFromCli();
  }

  async setFolderReviewed(folderPath: string, isReviewed: boolean): Promise<void> {
    if (!this.currentComparison) return;

    // Find all files under this folder path
    const filesInFolder = this.files.filter(
      (f) => f.relativePath === folderPath || f.relativePath.startsWith(`${folderPath}/`),
    );

    for (const file of filesInFolder) {
      for (const hunk of file.hunks) {
        if (isReviewed) {
          this.cliProvider.markHunk(file.relativePath, hunk.hash);
        } else {
          this.cliProvider.unmarkHunk(file.relativePath, hunk.hash);
        }
      }
    }

    await this.refreshFromCli();
  }

  async clearAllReviewed(): Promise<void> {
    if (!this.currentComparison) return;

    // Unmark all hunks in all files
    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (hunk.reviewed) {
          this.cliProvider.unmarkHunk(file.relativePath, hunk.hash);
        }
      }
    }

    await this.refreshFromCli();
  }

  async markAllReviewed(): Promise<void> {
    if (!this.currentComparison) return;

    // Mark all hunks in all files
    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (!hunk.reviewed) {
          this.cliProvider.markHunk(file.relativePath, hunk.hash);
        }
      }
    }

    await this.refreshFromCli();
  }

  private buildTree(files: ChangedFileWithStatus[]): TreeNode {
    const root: TreeNode = { name: "", path: "", children: new Map() };

    for (const file of files) {
      const parts = file.relativePath.split("/");
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        const nodePath = parts.slice(0, i + 1).join("/");

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            path: nodePath,
            children: new Map(),
          });
        }

        const node = current.children.get(part);
        if (node) {
          if (isFile) {
            node.file = file;
          }
          current = node;
        }
      }
    }

    // Compact single-child folders
    this.compactTree(root);

    return root;
  }

  private compactTree(node: TreeNode): void {
    for (const child of node.children.values()) {
      this.compactTree(child);
    }

    const newChildren = new Map<string, TreeNode>();

    for (const [, child] of node.children) {
      if (!child.file && child.children.size === 1) {
        let collapsed = child;
        let collapsedName = child.name;

        while (!collapsed.file && collapsed.children.size === 1) {
          const next = Array.from(collapsed.children.values())[0];

          // Don't collapse into a file - files should stay inside folders
          if (next.file) {
            break;
          }

          collapsedName += `/${next.name}`;
          collapsed = next;

          if (next.children.size !== 1) {
            break;
          }
        }

        newChildren.set(collapsedName, {
          name: collapsedName,
          path: collapsed.path,
          children: collapsed.children,
          file: collapsed.file,
        });
      } else {
        newChildren.set(child.name, child);
      }
    }

    node.children = newChildren;
  }

  getTreeItem(element: FileTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileTreeItem): Promise<FileTreeItem[]> {
    if (this.files.length === 0) {
      return [];
    }

    // Root level: show two sections
    if (!element) {
      const sections: FileTreeItem[] = [];

      if (this.reviewedTree && this.reviewedTree.children.size > 0) {
        const count = this.countFiles(this.reviewedTree);
        sections.push(FileTreeItem.createSection("reviewed", count));
      }

      if (this.toReviewTree && this.toReviewTree.children.size > 0) {
        const count = this.countFiles(this.toReviewTree);
        sections.push(FileTreeItem.createSection("toReview", count));
      }

      return sections;
    }

    // Section level: return the tree root's children
    if (element.section) {
      const tree = element.section === "reviewed" ? this.reviewedTree : this.toReviewTree;
      if (!tree) return [];

      return this.getNodeChildren(tree, element.section === "reviewed");
    }

    // Folder level: return folder's children
    if (element.nodePath && !element.file) {
      const tree = element.isReviewed === true ? this.reviewedTree : this.toReviewTree;
      if (!tree) return [];

      const node = this.findNode(tree, element.nodePath);
      if (!node) return [];

      return this.getNodeChildren(node, element.isReviewed === true);
    }

    return [];
  }

  private getNodeChildren(node: TreeNode, isReviewedSection: boolean): FileTreeItem[] {
    const items: FileTreeItem[] = [];

    // Sort: folders first, then alphabetically
    const sorted = Array.from(node.children.values()).sort((a, b) => {
      const aIsFolder = !a.file && a.children.size > 0;
      const bIsFolder = !b.file && b.children.size > 0;
      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of sorted) {
      if (child.file) {
        // Add file - use node name as label (includes path if compacted)
        items.push(FileTreeItem.createFile(child.file, isReviewedSection, child.name));
      } else {
        // Add folder
        items.push(FileTreeItem.createFolder(child.name, child.path, isReviewedSection));
      }
    }

    return items;
  }

  private findNode(root: TreeNode, nodePath: string): TreeNode | null {
    if (root.path === nodePath) {
      return root;
    }

    for (const child of root.children.values()) {
      const found = this.findNode(child, nodePath);
      if (found) return found;
    }

    return null;
  }

  private countFiles(node: TreeNode): number {
    let count = 0;
    if (node.file) count = 1;
    for (const child of node.children.values()) {
      count += this.countFiles(child);
    }
    return count;
  }

  private hasAnyReviewedHunk(file: ChangedFileWithStatus): boolean {
    if (file.hunks.length === 0) return false;
    return file.hunks.some((h) => h.reviewed);
  }

  private hasAnyUnreviewedHunk(file: ChangedFileWithStatus): boolean {
    if (file.hunks.length === 0) return true; // No hunks = unreviewed
    return file.hunks.some((h) => !h.reviewed);
  }
}

export class FileTreeItem extends vscode.TreeItem {
  public readonly section?: SectionType;
  public readonly file?: ChangedFileWithStatus;
  public readonly isReviewed?: boolean;
  public readonly nodePath?: string;

  private constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
  }

  static createSection(section: SectionType, count: number): FileTreeItem {
    // Use just the section name as label, count as description (like VS Code's native views)
    const item = new FileTreeItem(
      section === "toReview" ? "To Review" : "Reviewed",
      vscode.TreeItemCollapsibleState.Expanded,
    );
    (item as { section: SectionType }).section = section;
    item.id = `section:${section}`;
    item.contextValue = section === "toReview" ? "toReviewSection" : "reviewedSection";
    item.description = `${count}`;
    item.iconPath = new vscode.ThemeIcon(
      section === "toReview" ? "eye" : "pass-filled",
      new vscode.ThemeColor(
        section === "toReview" ? "list.warningForeground" : "testing.iconPassed",
      ),
    );
    return item;
  }

  static createFolder(name: string, nodePath: string, isReviewed: boolean): FileTreeItem {
    const item = new FileTreeItem(name, vscode.TreeItemCollapsibleState.Expanded);
    (item as { nodePath: string }).nodePath = nodePath;
    (item as { isReviewed: boolean }).isReviewed = isReviewed;
    item.id = `folder:${isReviewed ? "reviewed" : "toReview"}:${nodePath}`;
    item.contextValue = isReviewed ? "reviewedFolder" : "unreviewedFolder";
    return item;
  }

  static createFile(
    file: ChangedFileWithStatus,
    isReviewed: boolean,
    displayName?: string,
  ): FileTreeItem {
    // Use displayName if provided (for compacted paths), otherwise just the filename
    const label = displayName || file.relativePath.split("/").pop() || file.relativePath;
    const item = new FileTreeItem(label, vscode.TreeItemCollapsibleState.None);

    (item as { file: ChangedFileWithStatus }).file = file;
    (item as { isReviewed: boolean }).isReviewed = isReviewed;

    item.id = `file:${isReviewed ? "reviewed" : "toReview"}:${file.relativePath}`;
    item.contextValue = isReviewed ? "reviewedFile" : "unreviewedFile";

    const statusIcons: Record<string, string> = {
      added: "A",
      modified: "M",
      deleted: "D",
      renamed: "R",
      untracked: "U",
    };
    item.description = statusIcons[file.status] || "";

    item.resourceUri = vscode.Uri.file(file.absolutePath);

    item.command = {
      command: "human-review.openDiff",
      title: "Open Diff",
      arguments: [file.relativePath, file.status, undefined, file.oldPath],
    };

    return item;
  }
}
