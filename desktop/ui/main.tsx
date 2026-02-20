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

/** Load preferences and gate app content to avoid a theme flash. */
function PreferencesGate({ children }: { children: React.ReactNode }) {
  const loadPreferences = useReviewStore((s) => s.loadPreferences);
  const loaded = useReviewStore((s) => s.preferencesLoaded);

  useEffect(() => {
    loadPreferences().then(() => {
      document.getElementById("initial-loader")?.remove();
    });
  }, [loadPreferences]);

  if (!loaded) return null;
  return <>{children}</>;
}

// Initialize Sentry early (events are dropped until user opts in)
initSentry();

// Initialize file logging (patches console.*)
initializeLogger();

// Pre-resolve common languages in background to warm the cache.
// WorkerPoolContextProvider calls resolveLanguages() itself during init,
// so syntax highlighting works regardless of whether this finishes first.
resolveLanguages([...commonLanguages]).catch((err) => {
  console.warn("[main] Failed to preload syntax highlighting languages:", err);
});

/** Renders the worker pool + app after preferences are loaded,
 *  so the initial theme is always correct (no flash). */
function App() {
  // Safe to read synchronously here — PreferencesGate guarantees
  // loadPreferences() has completed before this component mounts.
  const codeTheme = useReviewStore((s) => s.codeTheme);

  return (
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
        theme: { dark: codeTheme, light: codeTheme },
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
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PreferencesGate>
        <App />
      </PreferencesGate>
    </ErrorBoundary>
  </React.StrictMode>,
);
