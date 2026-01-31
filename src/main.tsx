// Install mock Tauri APIs before any Tauri calls happen
// This must run before App renders and triggers useEffect hooks
import { installMockTauri } from "./utils/tauriMock";
installMockTauri();

import React from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { initializeLogger } from "./utils/logger";

// Preload syntax highlighting languages for @pierre/diffs
// This ensures languages are resolved before components render
import { resolveLanguages } from "@pierre/diffs";
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

// Initialize file logging (patches console.*)
initializeLogger();

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
          <AppRouter />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });

// Remove initial loading indicator
document.getElementById("initial-loader")?.remove();
