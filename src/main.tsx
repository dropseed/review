// Install mock Tauri APIs before any Tauri calls happen
// This must run before App renders and triggers useEffect hooks
import { installMockTauri } from "./utils/tauriMock";
installMockTauri();

import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { initSentry } from "./utils/sentry";
import { initializeLogger } from "./utils/logger";
import { useReviewStore } from "./stores";

// Preload syntax highlighting languages for @pierre/diffs
// This ensures languages are resolved before components render
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

// Keeps the worker pool's syntax highlighting theme in sync with user preferences
function WorkerPoolThemeSync() {
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

// Wait for languages to resolve before rendering the app
// This fixes syntax highlighting not working in production builds
resolveLanguages([...commonLanguages])
  .catch((err) => {
    console.warn(
      "[main] Failed to preload syntax highlighting languages:",
      err,
    );
  })
  .finally(() => {
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
          </WorkerPoolContextProvider>
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });

// Remove initial loading indicator
document.getElementById("initial-loader")?.remove();
