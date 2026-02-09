import type {
  Comparison,
  DiffHunk,
  FileContent,
  FileEntry,
  GlobalReviewSummary,
  ReviewState,
  ServerInfo,
  TrustCategory,
} from "./types";

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    return response.json();
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    return response.json();
  }

  private buildRepoQuery(repoPath: string): string {
    return `repo=${encodeURIComponent(repoPath)}`;
  }

  private buildComparisonQuery(comparison: Comparison): string {
    const parts = [
      `old=${encodeURIComponent(comparison.old)}`,
      `new=${encodeURIComponent(comparison.new)}`,
    ];
    if (comparison.workingTree) {
      parts.push("workingTree=true");
    }
    return parts.join("&");
  }

  // Health check (no auth required)
  async getHealth(): Promise<{ status: string }> {
    const url = `${this.baseUrl}/health`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  async getInfo(): Promise<ServerInfo> {
    return this.fetchJson<ServerInfo>("/info");
  }

  async getReviewsGlobal(): Promise<GlobalReviewSummary[]> {
    return this.fetchJson<GlobalReviewSummary[]>("/reviews/global");
  }

  async getFiles(
    repoPath: string,
    comparison: Comparison
  ): Promise<FileEntry[]> {
    return this.fetchJson<FileEntry[]>(
      `/files?${this.buildRepoQuery(repoPath)}&${this.buildComparisonQuery(comparison)}`
    );
  }

  async getFile(
    repoPath: string,
    filePath: string,
    comparison: Comparison
  ): Promise<FileContent> {
    return this.fetchJson<FileContent>(
      `/file?${this.buildRepoQuery(repoPath)}&path=${encodeURIComponent(filePath)}&${this.buildComparisonQuery(comparison)}`
    );
  }

  async getAllHunks(
    repoPath: string,
    comparison: Comparison,
    filePaths: string[]
  ): Promise<DiffHunk[]> {
    return this.postJson<DiffHunk[]>("/hunks", {
      repo: repoPath,
      comparison,
      filePaths,
    });
  }

  async getState(
    repoPath: string,
    comparison: Comparison
  ): Promise<ReviewState> {
    return this.fetchJson<ReviewState>(
      `/state?${this.buildRepoQuery(repoPath)}&${this.buildComparisonQuery(comparison)}`
    );
  }

  async saveState(repoPath: string, state: ReviewState): Promise<void> {
    await this.postJson(`/state?${this.buildRepoQuery(repoPath)}`, state);
  }

  async getTaxonomy(repoPath: string): Promise<TrustCategory[]> {
    return this.fetchJson<TrustCategory[]>(
      `/taxonomy?${this.buildRepoQuery(repoPath)}`
    );
  }
}
