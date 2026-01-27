// Install mock Tauri APIs before any Tauri calls happen
// This must run before App renders and triggers useEffect hooks
import { installMockTauri } from "./utils/tauriMock";
installMockTauri();

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { initializeLogger } from "./utils/logger";

// Initialize file logging (patches console.*)
initializeLogger();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
