import { invoke } from "@tauri-apps/api/core";

const LOG_FILE = ".git/compare/app.log";
let repoPath: string | null = null;

// Set the repo path for logging (call this once app knows the repo)
export function setLoggerRepoPath(path: string | null) {
  repoPath = path;
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

// Write to log file (fire and forget)
function writeToFile(line: string) {
  if (!repoPath) return;
  const fullPath = `${repoPath}/${LOG_FILE}`;
  invoke("append_to_file", { path: fullPath, contents: line }).catch(() => {
    // Silently fail
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

// Patch console methods to also write to file
export function initializeLogger() {
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

// Clear the log file
export async function clearLog() {
  if (!repoPath) return;
  const fullPath = `${repoPath}/${LOG_FILE}`;
  try {
    await invoke("write_text_file", { path: fullPath, contents: "" });
  } catch {
    // Silently fail
  }
}
