import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";

let logFilePath: string | null = null;

/** Resolve the app-wide log file path. Call once at startup. */
export function initLogPath(): void {
  if (logFilePath) return;

  getApiClient()
    .getReviewRoot()
    .then((root) => {
      if (!root) return;
      logFilePath = `${root}/app.log`;
    })
    .catch(() => {
      // Silently fall back -- no log file
    });
}

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

function writeToFile(line: string): void {
  if (!logFilePath) return;
  if (!isTauriEnvironment()) return;

  import("@tauri-apps/api/core").then(({ invoke }) => {
    invoke("append_to_file", { path: logFilePath, contents: line }).catch(
      () => {
        // Silently fail
      },
    );
  });
}

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

/** Patch console methods to also write to file (dev only). */
export function initializeLogger(): void {
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

  console.log("Logger initialized");
}

/** Clear the log file (dev only). */
export function clearLog(): void {
  if (!import.meta.env.DEV) return;
  if (!logFilePath) return;
  if (!isTauriEnvironment()) return;

  import("@tauri-apps/api/core").then(({ invoke }) => {
    invoke("write_text_file", { path: logFilePath, contents: "" }).catch(
      () => {},
    );
  });
}
