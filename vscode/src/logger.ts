import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

let logFile: string | null = null;

export function initLogger(): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    const logDir = path.join(workspaceFolder.uri.fsPath, ".human-review");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    logFile = path.join(logDir, "extension.log");
    // Clear old log on startup
    fs.writeFileSync(logFile, `[${new Date().toISOString()}] Logger initialized\n`);
  }
}

export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = data
    ? `[${timestamp}] ${message} ${JSON.stringify(data)}\n`
    : `[${timestamp}] ${message}\n`;

  console.log(`[HumanReview] ${message}`, data ?? "");

  if (logFile) {
    try {
      fs.appendFileSync(logFile, line);
    } catch {
      // Ignore write errors
    }
  }
}

export function logError(message: string, error: unknown): void {
  const timestamp = new Date().toISOString();
  const errorInfo = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  const line = `[${timestamp}] ERROR: ${message} ${JSON.stringify(errorInfo)}\n`;

  console.error(`[HumanReview] ERROR: ${message}`, error);

  if (logFile) {
    try {
      fs.appendFileSync(logFile, line);
    } catch {
      // Ignore write errors
    }
  }
}
