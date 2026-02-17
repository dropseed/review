// Install mock Tauri APIs before any Tauri calls happen
// This must run before App renders and triggers useEffect hooks
import { installMockTauri } from "./utils/tauriMock";
installMockTauri();

import { scan } from "react-scan";
scan({ enabled: import.meta.env.DEV });

import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "sonner";
import "./index.css";
import { initSentry } from "./utils/sentry";
import { initializeLogger } from "./utils/logger";
import { useReviewStore } from "./stores";

import { resolveLanguages } from "@pierre/diffs";
import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
const commonLanguages = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "python",
  "rust",
  "go",
  "json",
  "yaml",
  "html",
  "css",
  "markdown",
  "bash",
  "ruby",
  "java",
  "c",
  "cpp",
] as const;

function WorkerPoolThemeSync(): null {
  const pool = useWorkerPool();
  const codeTheme = useReviewStore((s) => s.codeTheme);

  useEffect(() => {
    pool?.setRenderOptions({
      theme: { dark: codeTheme, light: codeTheme },
    });
  }, [pool, codeTheme]);

  return null;
}

// Initialize Sentry early (events are dropped until user opts in)
initSentry();

// Initialize file logging (patches console.*)
initializeLogger();

// Read the initial theme so workers start with the right one
const initialTheme = useReviewStore.getState().codeTheme;

// Pre-resolve common languages in background to warm the cache.
// WorkerPoolContextProvider calls resolveLanguages() itself during init,
// so syntax highlighting works regardless of whether this finishes first.
resolveLanguages([...commonLanguages]).catch((err) => {
  console.warn("[main] Failed to preload syntax highlighting languages:", err);
});

// Render immediately — don't block on language resolution
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WorkerPoolContextProvider
        poolOptions={{
          workerFactory: () =>
            new Worker(
              new URL("@pierre/diffs/worker/worker.js", import.meta.url),
              { type: "module" },
            ),
          poolSize: Math.min(navigator.hardwareConcurrency || 4, 8),
        }}
        highlighterOptions={{
          langs: [...commonLanguages],
          theme: { dark: initialTheme, light: initialTheme },
          lineDiffType: "word-alt",
          tokenizeMaxLineLength: 1000,
        }}
      >
        <WorkerPoolThemeSync />
        <AppRouter />
        <Toaster
          theme="system"
          position="bottom-left"
          toastOptions={{
            style: {
              background: "var(--color-surface-overlay)",
              color: "var(--color-fg-secondary)",
              border: "1px solid var(--color-edge)",
            },
          }}
        />
      </WorkerPoolContextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Remove initial loading indicator
document.getElementById("initial-loader")?.remove();
