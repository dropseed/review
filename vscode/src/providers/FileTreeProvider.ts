import * as vscode from "vscode";
import { logError } from "../logger";
import type {
  ChangedFile,
  ChangedFileWithStatus,
  DiffHunk,
  HunkWithStatus,
  ReviewState,
} from "../state/types";
import { StateService } from "../state/StateService";
import { parseDiffToHunks, parseNameStatus, createUntrackedHunk } from "../diff/parser";
import { gitDiff, gitDiffNameStatus, gitUntrackedFiles, gitMergeBase } from "../git/operations";
import { isLabelTrusted } from "../trust/matching";
import { getHunkKey } from "../utils/hash";
import { buildDiffContent, buildClassifyPrompt, getUnlabeledHunks } from "../classify/prompt";
import { runClassification } from "../classify/claude";
import type { GitProvider } from "./GitProvider";

type SectionType = "reviewed" | "needsReview";

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
  private lastSetComparison: string | null = null;
  private files: ChangedFileWithStatus[] = [];
  private state: ReviewState | null = null;
  private stateService: StateService | null = null;
  private reviewedTree: TreeNode | null = null;
  private needsReviewTree: TreeNode | null = null;

  constructor(private gitProvider: GitProvider) {}

  /**
   * Initialize the state service. Called after GitProvider is ready.
   */
  initialize(): void {
    const workspaceRoot = this.gitProvider.getWorkspaceRoot();
    if (workspaceRoot) {
      this.stateService = StateService.create(workspaceRoot);
      // Load current comparison if it exists
      if (this.stateService) {
        const current = this.stateService.getCurrentComparison();
        if (current) {
          this.currentComparison = current;
          this.lastSetComparison = current;
          this.state = this.stateService.load(current);
        }
      }
    }
  }

  async selectComparison(comparison: string): Promise<void> {
    if (comparison === this.lastSetComparison) {
      return;
    }

    this.lastSetComparison = comparison;
    this.currentComparison = comparison;

    const workspaceRoot = this.gitProvider.getWorkspaceRoot();
    if (!workspaceRoot || !this.stateService) {
      return;
    }

    // Save the current comparison
    this.stateService.setCurrentComparison(comparison);

    // Load or create state for this comparison
    this.state = this.stateService.load(comparison);

    // Refresh files from git
    await this.refreshFromGit();
  }

  async refreshFromGit(): Promise<void> {
    try {
      const workspaceRoot = this.gitProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        this.files = [];
        this.currentComparison = null;
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      // Initialize state service if not already done
      if (!this.stateService) {
        this.stateService = StateService.create(workspaceRoot);
      }

      // Load current comparison if not set
      if (!this.currentComparison && this.stateService) {
        this.currentComparison = this.stateService.getCurrentComparison();
        this.lastSetComparison = this.currentComparison;
        if (this.currentComparison) {
          this.state = this.stateService.load(this.currentComparison);
        }
      }

      if (!this.currentComparison || !this.state) {
        this.files = [];
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      // Parse comparison key
      let baseRef: string;
      let compareRef: string | null = null;
      let isWorkingTree = false;

      if (this.currentComparison.endsWith("+working-tree")) {
        isWorkingTree = true;
        const withoutSuffix = this.currentComparison.slice(0, -13);
        if (withoutSuffix.includes("..")) {
          const parts = withoutSuffix.split("..");
          baseRef = parts[0];
          compareRef = parts[1];
        } else {
          baseRef = withoutSuffix;
        }
      } else if (this.currentComparison.includes("..")) {
        const parts = this.currentComparison.split("..");
        baseRef = parts[0];
        compareRef = parts[1];
      } else {
        baseRef = this.currentComparison;
        isWorkingTree = true;
      }

      // Get the merge base for the diff
      let effectiveBase = baseRef;
      if (compareRef) {
        try {
          effectiveBase = gitMergeBase(baseRef, compareRef, workspaceRoot);
        } catch {
          // Fall back to baseRef if merge-base fails
        }
      }

      // Get diff and name-status
      const compare = isWorkingTree ? null : compareRef;
      const diffOutput = gitDiff(effectiveBase, compare, workspaceRoot);
      const nameStatusOutput = gitDiffNameStatus(effectiveBase, compare, workspaceRoot);
      const statusMap = parseNameStatus(nameStatusOutput);

      // Parse diff into files
      const parsedFiles = parseDiffToHunks(diffOutput, statusMap);

      // Add untracked files if working tree comparison
      if (isWorkingTree) {
        const untracked = gitUntrackedFiles(workspaceRoot);
        for (const filePath of untracked) {
          const existing = parsedFiles.find((f) => f.path === filePath);
          if (!existing) {
            parsedFiles.push({
              path: filePath,
              status: "untracked",
              old_path: null,
              hunks: [createUntrackedHunk(filePath, "")],
            });
          }
        }
      }

      // Get trust list
      const trustList = this.state.trust_label || [];

      // Convert to ChangedFileWithStatus
      this.files = parsedFiles.map((f) => ({
        path: `${workspaceRoot}/${f.path}`,
        absolutePath: `${workspaceRoot}/${f.path}`,
        relativePath: f.path,
        old_path: f.old_path ?? undefined,
        status: f.status,
        hunks: f.hunks.map((h) => this.enrichHunk(h, trustList)),
      }));

      this.rebuildTrees();
      this._onDidChangeTreeData.fire(undefined);
    } catch (err) {
      logError("Failed to get files from git", err);
      this.files = [];
      this.currentComparison = null;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  private enrichHunk(hunk: DiffHunk, trustList: string[]): HunkWithStatus {
    const hunkKey = getHunkKey(hunk.filePath, hunk.hash);
    const hunkState = this.state?.hunks[hunkKey];

    const labels = hunkState?.label || [];
    const reasoning = hunkState?.reasoning || null;
    const reviewed = hunkState?.approved_via === "review";

    // Check if all labels are trusted
    const trusted = labels.length > 0 && labels.every((label) => isLabelTrusted(label, trustList));
    const approved = reviewed || trusted;

    return {
      ...hunk,
      labels,
      reasoning,
      trusted,
      reviewed,
      approved,
    };
  }

  private rebuildTrees(): void {
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
    this.refreshFromGit();
  }

  async setHunkReviewed(filePath: string, hunkHash: string, isReviewed: boolean): Promise<void> {
    if (!this.currentComparison || !this.stateService) return;

    const hunkKey = getHunkKey(filePath, hunkHash);
    if (isReviewed) {
      this.stateService.approveHunk(this.currentComparison, hunkKey);
    } else {
      this.stateService.unapproveHunk(this.currentComparison, hunkKey);
    }

    // Reload state
    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
  }

  async setFileReviewed(relativePath: string, isReviewed: boolean): Promise<void> {
    if (!this.currentComparison || !this.stateService) return;

    const file = this.files.find((f) => f.relativePath === relativePath);
    if (!file) return;

    for (const hunk of file.hunks) {
      const hunkKey = getHunkKey(hunk.filePath, hunk.hash);
      if (isReviewed) {
        this.stateService.approveHunk(this.currentComparison, hunkKey);
      } else {
        this.stateService.unapproveHunk(this.currentComparison, hunkKey);
      }
    }

    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
  }

  async setFolderReviewed(folderPath: string, isReviewed: boolean): Promise<void> {
    if (!this.currentComparison || !this.stateService) return;

    const filesInFolder = this.files.filter(
      (f) => f.relativePath === folderPath || f.relativePath.startsWith(`${folderPath}/`),
    );

    for (const file of filesInFolder) {
      for (const hunk of file.hunks) {
        const hunkKey = getHunkKey(hunk.filePath, hunk.hash);
        if (isReviewed) {
          this.stateService.approveHunk(this.currentComparison, hunkKey);
        } else {
          this.stateService.unapproveHunk(this.currentComparison, hunkKey);
        }
      }
    }

    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
  }

  async clearAllReviewed(): Promise<void> {
    if (!this.currentComparison || !this.stateService) return;

    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (hunk.approved) {
          const hunkKey = getHunkKey(hunk.filePath, hunk.hash);
          this.stateService.unapproveHunk(this.currentComparison, hunkKey);
        }
      }
    }

    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
  }

  async markAllReviewed(): Promise<void> {
    if (!this.currentComparison || !this.stateService) return;

    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (!hunk.approved) {
          const hunkKey = getHunkKey(hunk.filePath, hunk.hash);
          this.stateService.approveHunk(this.currentComparison, hunkKey);
        }
      }
    }

    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
  }

  async trustLabel(label: string): Promise<void> {
    if (!this.currentComparison || !this.stateService) return;
    this.stateService.addTrustLabel(this.currentComparison, label);
    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
  }

  async untrustLabel(label: string): Promise<void> {
    if (!this.currentComparison || !this.stateService) return;
    this.stateService.removeTrustLabel(this.currentComparison, label);
    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
  }

  getLabelsWithCounts(): Map<string, { count: number; trusted: boolean }> {
    const labelCounts = new Map<string, { count: number; trusted: boolean }>();
    const trustList = this.state?.trust_label || [];

    for (const file of this.files) {
      for (const hunk of file.hunks) {
        for (const label of hunk.labels) {
          const existing = labelCounts.get(label);
          if (existing) {
            existing.count++;
          } else {
            labelCounts.set(label, {
              count: 1,
              trusted: isLabelTrusted(label, trustList),
            });
          }
        }
      }
    }

    return labelCounts;
  }

  getUnclassifiedCount(): number {
    let count = 0;
    for (const file of this.files) {
      for (const hunk of file.hunks) {
        if (hunk.labels.length === 0 && hunk.reasoning === null) {
          count++;
        }
      }
    }
    return count;
  }

  async classify(): Promise<void> {
    if (!this.currentComparison || !this.stateService || !this.state) {
      throw new Error("No comparison selected");
    }

    const workspaceRoot = this.gitProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error("No workspace root");
    }

    // Convert files to ChangedFile format for getUnlabeledHunks
    const changedFiles: ChangedFile[] = this.files.map((f) => ({
      path: f.relativePath,
      status: f.status,
      old_path: f.old_path ?? null,
      hunks: f.hunks.map((h) => ({
        filePath: h.filePath,
        hash: h.hash,
        header: h.header,
        content: h.content,
        startLine: h.startLine,
        endLine: h.endLine,
      })),
    }));

    const unlabeled = getUnlabeledHunks(changedFiles, this.state.hunks);
    if (unlabeled.length === 0) {
      return;
    }

    const diffContent = buildDiffContent(unlabeled);
    const prompt = buildClassifyPrompt(diffContent);

    const result = await runClassification(prompt, workspaceRoot);
    if (!result.success) {
      throw new Error(result.error);
    }

    if (result.classifications) {
      this.stateService.setHunkClassifications(this.currentComparison, result.classifications);
    }

    this.state = this.stateService.load(this.currentComparison);
    await this.refreshFromGit();
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
          if (next.file) break;
          collapsedName += `/${next.name}`;
          collapsed = next;
          if (next.children.size !== 1) break;
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

    if (!element) {
      const sections: FileTreeItem[] = [];

      if (this.reviewedTree && this.reviewedTree.children.size > 0) {
        const count = this.countHunks(this.reviewedTree, true);
        sections.push(FileTreeItem.createSection("reviewed", count));
      }

      if (this.needsReviewTree && this.needsReviewTree.children.size > 0) {
        const count = this.countHunks(this.needsReviewTree, false);
        sections.push(FileTreeItem.createSection("needsReview", count));
      }

      return sections;
    }

    if (element.section) {
      const tree = element.section === "reviewed" ? this.reviewedTree : this.needsReviewTree;
      if (!tree) return [];
      return this.getNodeChildren(tree, element.section);
    }

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

    const sorted = Array.from(node.children.values()).sort((a, b) => {
      const aIsFolder = !a.file && a.children.size > 0;
      const bIsFolder = !b.file && b.children.size > 0;
      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of sorted) {
      if (child.file) {
        items.push(FileTreeItem.createFile(child.file, sectionType, child.name));
      } else {
        items.push(FileTreeItem.createFolder(child.name, child.path, sectionType));
      }
    }

    return items;
  }

  private findNode(root: TreeNode, nodePath: string): TreeNode | null {
    if (root.path === nodePath) return root;
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

  private countHunks(node: TreeNode, approved: boolean): number {
    let count = 0;
    if (node.file) {
      count = node.file.hunks.filter((h) => h.approved === approved).length;
    }
    for (const child of node.children.values()) {
      count += this.countHunks(child, approved);
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

    const contextValues: Record<SectionType, string> = {
      reviewed: "reviewedSection",
      needsReview: "needsReviewSection",
    };
    item.contextValue = contextValues[section];
    item.description = `${count}`;

    const iconConfig: Record<SectionType, { icon: string; color: string }> = {
      reviewed: { icon: "check-all", color: "testing.iconPassed" },
      needsReview: { icon: "circle-large-outline", color: "list.warningForeground" },
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
      arguments: [file.relativePath, file.status, undefined, file.old_path],
    };

    return item;
  }
}
