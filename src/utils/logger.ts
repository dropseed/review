import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";

let logFilePath: string | null = null;

// Set the log file path directly (call once central storage path is known)
export function setLogFilePath(path: string | null) {
  logFilePath = path;
}

// Resolve the central storage path for a repo and set the log file path.
export function initLogPath(repoPath: string): void {
  getApiClient()
    .getReviewStoragePath(repoPath)
    .then((storagePath) => {
      if (storagePath) {
        setLogFilePath(`${storagePath}/app.log`);
      }
    })
    .catch(() => {
      // Silently fall back -- no log file
    });
}

// Format a log message with timestamp and level
function formatMessage(level: string, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
  return `[${timestamp}] [${level}] ${message}\n`;
}

// Write to log file (fire and forget) - only in Tauri environment
function writeToFile(line: string) {
  if (!logFilePath) return;
  if (!isTauriEnvironment()) return;

  // Dynamically import to avoid loading Tauri in browser
  import("@tauri-apps/api/core").then(({ invoke }) => {
    invoke("append_to_file", { path: logFilePath, contents: line }).catch(
      () => {
        // Silently fail
      },
    );
  });
}

// Store original console methods
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

// Patch console methods to also write to file (dev only)
export function initializeLogger() {
  if (!import.meta.env.DEV) return;
  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    writeToFile(formatMessage("LOG", args));
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    writeToFile(formatMessage("WARN", args));
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    writeToFile(formatMessage("ERROR", args));
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    writeToFile(formatMessage("INFO", args));
  };

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    writeToFile(formatMessage("DEBUG", args));
  };

  // Log startup
  console.log("Logger initialized");
}

// Clear the log file (dev only)
export async function clearLog() {
  if (!import.meta.env.DEV) return;
  if (!logFilePath) return;
  if (!isTauriEnvironment()) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_text_file", { path: logFilePath, contents: "" });
  } catch {
    // Silently fail
  }
}
