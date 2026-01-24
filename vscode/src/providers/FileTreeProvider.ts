import * as vscode from "vscode";
import { logError } from "../logger";
import type { CliFile, CliHunk, DiffHunk } from "../types";
import type { CliProvider } from "./CliProvider";
import type { GitProvider } from "./GitProvider";

type SectionType = "reviewed" | "needsReview";

// Extended hunk type with all status fields from CLI
interface HunkWithStatus extends DiffHunk {
  labels: string[];
  reasoning: string | null;
  trusted: boolean;
  reviewed: boolean;
  approved: boolean;
}

// Internal file representation with hunks that include review status
interface ChangedFileWithStatus {
  path: string;
  absolutePath: string;
  relativePath: string;
  oldPath?: string;
  status: string;
  hunks: HunkWithStatus[];
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
  private trustList: string[] = []; // Currently trusted patterns
  private reviewedTree: TreeNode | null = null;
  private needsReviewTree: TreeNode | null = null;

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
      this.trustList = cliOutput.trust_list || [];

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
          labels: h.labels || [],
          reasoning: h.reasoning,
          trusted: h.trusted || false,
          reviewed: h.reviewed || false,
          approved: h.approved || false,
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
    // Files can appear in both sections based on hunk state:
    // - Reviewed: has ANY approved hunk (trusted OR manually reviewed)
    // - Needs Review: has ANY unapproved hunk

    const reviewedFiles = this.files.filter((f) => this.hasAnyApprovedHunk(f));
    const needsReviewFiles = this.files.filter((f) => this.hasAnyUnapprovedHunk(f));

    this.reviewedTree = this.buildTree(reviewedFiles);
    this.needsReviewTree = this.buildTree(needsReviewFiles);
  }

  private hasAnyApprovedHunk(file: ChangedFileWithStatus): boolean {
    return file.hunks.some((h) => h.approved);
  }

  private hasAnyUnapprovedHunk(file: ChangedFileWithStatus): boolean {
    if (file.hunks.length === 0) return true;
    return file.hunks.some((h) => !h.approved);
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
      this.cliProvider.approveHunk(filePath, hunkHash);
    } else {
      this.cliProvider.unapproveHunk(filePath, hunkHash);
    }

    await this.refreshFromCli();
  }

  async setFileReviewed(relativePath: string, isReviewed: boolean): Promise<void> {
    if (!this.currentComparison) return;

    // Approve/unapprove the entire file at once
    if (isReviewed) {
      this.cliProvider.approveFile(relativePath);
    } else {
      this.cliProvider.unapproveFile(relativePath);
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
      if (isReviewed) {
        this.cliProvider.approveFile(file.relativePath);
      } else {
        this.cliProvider.unapproveFile(file.relativePath);
      }
    }

    await this.refreshFromCli();
  }

  async clearAllReviewed(): Promise<void> {
    if (!this.currentComparison) return;

    // Unapprove all hunks in all files
    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (hunk.approved) {
          this.cliProvider.unapproveHunk(file.relativePath, hunk.hash);
        }
      }
    }

    await this.refreshFromCli();
  }

  async markAllReviewed(): Promise<void> {
    if (!this.currentComparison) return;

    // Approve all hunks in all files
    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (!hunk.approved) {
          this.cliProvider.approveHunk(file.relativePath, hunk.hash);
        }
      }
    }

    await this.refreshFromCli();
  }

  async trustLabel(label: string): Promise<void> {
    if (!this.currentComparison) return;
    this.cliProvider.addTrust(label);
    await this.refreshFromCli();
  }

  async untrustLabel(label: string): Promise<void> {
    if (!this.currentComparison) return;
    this.cliProvider.removeTrust(label);
    await this.refreshFromCli();
  }

  /**
   * Get all unique labels from the current diff with their counts
   */
  getLabelsWithCounts(): Map<string, { count: number; trusted: boolean }> {
    const labelCounts = new Map<string, { count: number; trusted: boolean }>();

    for (const file of this.files) {
      for (const hunk of file.hunks) {
        for (const label of hunk.labels) {
          const existing = labelCounts.get(label);
          if (existing) {
            existing.count++;
          } else {
            // Check if this specific label is in the trust list
            const isTrusted = this.isLabelTrusted(label);
            labelCounts.set(label, { count: 1, trusted: isTrusted });
          }
        }
      }
    }

    return labelCounts;
  }

  /**
   * Count hunks that have no labels (not yet classified)
   */
  getUnclassifiedCount(): number {
    let count = 0;
    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (hunk.labels.length === 0) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Run classification on unlabeled hunks
   */
  async classify(): Promise<void> {
    if (!this.currentComparison) {
      throw new Error("No comparison selected");
    }
    this.cliProvider.classify();
    await this.refreshFromCli();
  }

  /**
   * Check if a label matches any pattern in the trust list
   */
  private isLabelTrusted(label: string): boolean {
    for (const pattern of this.trustList) {
      if (this.labelMatchesPattern(label, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a label matches a trust pattern (supports glob with *)
   */
  private labelMatchesPattern(label: string, pattern: string): boolean {
    if (pattern === label) return true;
    if (pattern.includes("*")) {
      // Convert glob pattern to regex
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(label);
    }
    return false;
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

      // Reviewed (approved via trust OR manual review)
      if (this.reviewedTree && this.reviewedTree.children.size > 0) {
        const count = this.countFiles(this.reviewedTree);
        sections.push(FileTreeItem.createSection("reviewed", count));
      }

      // Needs Review (not yet approved)
      if (this.needsReviewTree && this.needsReviewTree.children.size > 0) {
        const count = this.countFiles(this.needsReviewTree);
        sections.push(FileTreeItem.createSection("needsReview", count));
      }

      return sections;
    }

    // Section level: return the tree root's children
    if (element.section) {
      const tree = element.section === "reviewed" ? this.reviewedTree : this.needsReviewTree;
      if (!tree) return [];

      return this.getNodeChildren(tree, element.section);
    }

    // Folder level: return folder's children
    if (element.nodePath && !element.file) {
      const tree = element.sectionType === "reviewed" ? this.reviewedTree : this.needsReviewTree;
      if (!tree) return [];

      const node = this.findNode(tree, element.nodePath);
      if (!node) return [];

      return this.getNodeChildren(node, element.sectionType || "needsReview");
    }

    return [];
  }

  private getNodeChildren(node: TreeNode, sectionType: SectionType): FileTreeItem[] {
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
        items.push(FileTreeItem.createFile(child.file, sectionType, child.name));
      } else {
        // Add folder
        items.push(FileTreeItem.createFolder(child.name, child.path, sectionType));
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
}

export class FileTreeItem extends vscode.TreeItem {
  public readonly section?: SectionType;
  public readonly sectionType?: SectionType;
  public readonly file?: ChangedFileWithStatus;
  public readonly isReviewed?: boolean;
  public readonly nodePath?: string;

  private constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
  }

  static createSection(section: SectionType, count: number): FileTreeItem {
    const sectionLabels: Record<SectionType, string> = {
      reviewed: "Reviewed",
      needsReview: "Needs Review",
    };
    const item = new FileTreeItem(sectionLabels[section], vscode.TreeItemCollapsibleState.Expanded);
    (item as { section: SectionType }).section = section;
    item.id = `section:${section}`;

    // Set context values for commands
    const contextValues: Record<SectionType, string> = {
      reviewed: "reviewedSection",
      needsReview: "needsReviewSection",
    };
    item.contextValue = contextValues[section];
    item.description = `${count}`;

    // Set icons based on section type
    const iconConfig: Record<SectionType, { icon: string; color: string }> = {
      reviewed: { icon: "pass-filled", color: "testing.iconPassed" },
      needsReview: { icon: "eye", color: "list.warningForeground" },
    };
    const { icon, color } = iconConfig[section];
    item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));

    return item;
  }

  static createFolder(name: string, nodePath: string, sectionType: SectionType): FileTreeItem {
    const item = new FileTreeItem(name, vscode.TreeItemCollapsibleState.Expanded);
    (item as { nodePath: string }).nodePath = nodePath;
    (item as { sectionType: SectionType }).sectionType = sectionType;
    (item as { isReviewed: boolean }).isReviewed = sectionType === "reviewed";
    item.id = `folder:${sectionType}:${nodePath}`;

    const folderContextValues: Record<SectionType, string> = {
      reviewed: "reviewedFolder",
      needsReview: "unreviewedFolder",
    };
    item.contextValue = folderContextValues[sectionType];

    return item;
  }

  static createFile(
    file: ChangedFileWithStatus,
    sectionType: SectionType,
    displayName?: string,
  ): FileTreeItem {
    // Use displayName if provided (for compacted paths), otherwise just the filename
    const label = displayName || file.relativePath.split("/").pop() || file.relativePath;
    const item = new FileTreeItem(label, vscode.TreeItemCollapsibleState.None);

    (item as { file: ChangedFileWithStatus }).file = file;
    (item as { sectionType: SectionType }).sectionType = sectionType;
    (item as { isReviewed: boolean }).isReviewed = sectionType === "reviewed";

    item.id = `file:${sectionType}:${file.relativePath}`;

    const fileContextValues: Record<SectionType, string> = {
      reviewed: "reviewedFile",
      needsReview: "unreviewedFile",
    };
    item.contextValue = fileContextValues[sectionType];

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
