import { scan, setOptions } from "react-scan";
import { onScanRender, initReactScanLog } from "./utils/reactScanLog";
scan({});
// setOptions after scan() — scan's start() overwrites options from localStorage,
// which drops non-persisted keys like onRender.
if (import.meta.env.DEV) setOptions({ onRender: onScanRender });

import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "sonner";
// Fonts, bundled rather than fetched from Google at runtime. A desktop app that
// pulls its UI font over the network renders in a fallback face whenever the
// user is offline, and tells a third party every time the app is opened.
//
// Imported here, not from index.css: Vite rewrites `url()` references only in
// CSS it processes as a module, so importing these through a stylesheet leaves
// the woff2 paths relative and they resolve to nothing in the built app.
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";
// The terminal's font. An embedded terminal should measure its grid identically
// on every machine; a family that resolves differently per install makes cell
// width — and so every TUI's layout — machine-dependent.
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./index.css";
import { initSentry } from "./utils/sentry";
import { initializeLogger, initLogPath } from "./utils/logger";
import { installDevtools } from "./utils/devtools";
import { registerServiceWorker } from "./utils/register-sw";
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
    // setRenderOptions destructures with defaults, so every field we care
    // about has to be re-passed here or it silently reverts (notably
    // useTokenTransformer, which gates pierre's token hooks).
    pool?.setRenderOptions({
      theme: { dark: codeTheme, light: codeTheme },
      useTokenTransformer: true,
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

// Initialize file logging (patches console.*, writes to ~/.review/app.log)
initializeLogger();
initLogPath();

// Initialize React Scan perf log (writes to ~/.review/react-scan.jsonl)
initReactScanLog({ clear: true });

// Expose the store on window in dev builds only.
installDevtools();

// Make web mode installable (no-op under Tauri and on the dev server).
registerServiceWorker();

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
        // Required for onTokenEnter/onTokenLeave/onTokenClick to fire — the
        // worker has to emit the data-char attributes pierre's pointer-target
        // resolver reads.
        useTokenTransformer: true,
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
