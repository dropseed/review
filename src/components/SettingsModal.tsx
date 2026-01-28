import { useEffect, useState } from "react";
import { useReviewStore } from "../stores/reviewStore";
import { isTauriEnvironment } from "../api/client";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const THEMES: { value: string; label: string; colors: string[] }[] = [
  {
    value: "github-dark",
    label: "GitHub Dark",
    colors: ["#0d1117", "#c9d1d9", "#7ee787"],
  },
  {
    value: "monokai",
    label: "Monokai",
    colors: ["#272822", "#f8f8f2", "#a6e22e"],
  },
  {
    value: "dracula",
    label: "Dracula",
    colors: ["#282a36", "#f8f8f2", "#bd93f9"],
  },
  {
    value: "one-dark-pro",
    label: "One Dark Pro",
    colors: ["#282c34", "#abb2bf", "#98c379"],
  },
  {
    value: "tokyo-night",
    label: "Tokyo Night",
    colors: ["#1a1b26", "#c0caf5", "#9ece6a"],
  },
  { value: "nord", label: "Nord", colors: ["#2e3440", "#eceff4", "#a3be8c"] },
  {
    value: "solarized-dark",
    label: "Solarized",
    colors: ["#002b36", "#839496", "#859900"],
  },
  {
    value: "vitesse-dark",
    label: "Vitesse",
    colors: ["#121212", "#dbd7ca", "#4d9375"],
  },
];

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    sidebarPosition,
    setSidebarPosition,
    codeFontSize,
    setCodeFontSize,
    codeTheme,
    setCodeTheme,
    claudeAvailable,
    autoClassifyEnabled,
    setAutoClassifyEnabled,
    classifyCommand,
    setClassifyCommand,
    classifyBatchSize,
    setClassifyBatchSize,
    classifyMaxConcurrent,
    setClassifyMaxConcurrent,
    // Sync server
    syncServerEnabled,
    syncServerPort,
    syncAuthToken,
    syncServerRunning,
    syncTailscaleIp,
    syncError,
    setSyncServerEnabled,
    setSyncServerPort,
    regenerateAuthToken,
  } = useReviewStore();

  const [showToken, setShowToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const isTauri = isTauriEnvironment();

  const handleCopyToken = async () => {
    if (syncAuthToken) {
      await navigator.clipboard.writeText(syncAuthToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    }
  };

  const handleCopyUrl = async () => {
    if (syncTailscaleIp) {
      const url = `http://${syncTailscaleIp}:${syncServerPort}`;
      await navigator.clipboard.writeText(url);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    }
  };

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const decreaseFontSize = () => {
    setCodeFontSize(
      Math.max(codeFontSize - CODE_FONT_SIZE_STEP, CODE_FONT_SIZE_MIN),
    );
  };

  const increaseFontSize = () => {
    setCodeFontSize(
      Math.min(codeFontSize + CODE_FONT_SIZE_STEP, CODE_FONT_SIZE_MAX),
    );
  };

  const resetFontSize = () => {
    setCodeFontSize(CODE_FONT_SIZE_DEFAULT);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md max-h-[85vh] flex-col rounded-xl border border-stone-700/80 bg-stone-900 shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="relative border-b border-stone-800 px-5 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-lime-500/5" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-800 ring-1 ring-stone-700">
                <svg
                  className="h-4 w-4 text-stone-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-stone-100">Settings</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="divide-y divide-stone-800/60 overflow-y-auto flex-1 min-h-0">
          {/* Code Font Size */}
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
              <svg
                className="h-4 w-4 text-stone-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 7 4 4 20 4 20 7" />
                <line x1="9" y1="20" x2="15" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
              </svg>
              <span className="text-xs font-medium text-stone-300">
                Code Font Size
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-stone-800/50 px-3 py-2">
              <div className="flex items-center gap-2">
                {/* Decrease button */}
                <button
                  onClick={decreaseFontSize}
                  disabled={codeFontSize <= CODE_FONT_SIZE_MIN}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-700/50 text-stone-300 transition-colors hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Decrease font size (Cmd+-)"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M20 12H4"
                    />
                  </svg>
                </button>

                {/* Current size display */}
                <div className="flex min-w-[5.5rem] flex-col items-center px-3">
                  <span className="font-mono text-lg font-semibold text-stone-100 tabular-nums">
                    {codeFontSize}px
                  </span>
                </div>

                {/* Increase button */}
                <button
                  onClick={increaseFontSize}
                  disabled={codeFontSize >= CODE_FONT_SIZE_MAX}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-700/50 text-stone-300 transition-colors hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Increase font size (Cmd++)"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              </div>

              {/* Reset button */}
              {codeFontSize !== CODE_FONT_SIZE_DEFAULT && (
                <button
                  onClick={resetFontSize}
                  className="text-xxs text-stone-500 hover:text-stone-300 transition-colors"
                  title="Reset to default (Cmd+0)"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="mt-2 text-xxs text-stone-600">
              <kbd className="rounded bg-stone-800 px-1 py-0.5">Cmd</kbd>{" "}
              <kbd className="rounded bg-stone-800 px-1 py-0.5">+</kbd> /{" "}
              <kbd className="rounded bg-stone-800 px-1 py-0.5">-</kbd> to
              adjust, <kbd className="rounded bg-stone-800 px-1 py-0.5">0</kbd>{" "}
              to reset
            </p>
          </div>

          {/* Syntax Theme */}
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
              <svg
                className="h-4 w-4 text-stone-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
                <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
                <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
                <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
              </svg>
              <span className="text-xs font-medium text-stone-300">
                Syntax Theme
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  onClick={() => setCodeTheme(theme.value)}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150 ${
                    codeTheme === theme.value
                      ? "bg-stone-800 ring-1 ring-amber-500/50"
                      : "bg-stone-800/30 hover:bg-stone-800/60"
                  }`}
                >
                  {/* Theme color preview */}
                  <div className="flex gap-0.5">
                    {theme.colors.map((color, i) => (
                      <div
                        key={i}
                        className="h-4 w-2 first:rounded-l last:rounded-r"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <span
                    className={`text-xs font-medium transition-colors ${
                      codeTheme === theme.value
                        ? "text-stone-100"
                        : "text-stone-400 group-hover:text-stone-300"
                    }`}
                  >
                    {theme.label}
                  </span>
                  {codeTheme === theme.value && (
                    <svg
                      className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-amber-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Sidebar Position */}
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
              <svg
                className="h-4 w-4 text-stone-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
              <span className="text-xs font-medium text-stone-300">
                Sidebar Position
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSidebarPosition("left")}
                className={`group relative flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 transition-all duration-150 ${
                  sidebarPosition === "left"
                    ? "bg-stone-800 ring-1 ring-amber-500/50"
                    : "bg-stone-800/30 hover:bg-stone-800/60"
                }`}
              >
                {/* Mini layout preview */}
                <div className="flex h-6 w-10 overflow-hidden rounded border border-stone-600">
                  <div
                    className={`w-3 transition-colors ${
                      sidebarPosition === "left"
                        ? "bg-amber-500/40"
                        : "bg-stone-700"
                    }`}
                  />
                  <div className="flex-1 bg-stone-900" />
                </div>
                <span
                  className={`text-xs font-medium transition-colors ${
                    sidebarPosition === "left"
                      ? "text-stone-100"
                      : "text-stone-400 group-hover:text-stone-300"
                  }`}
                >
                  Left
                </span>
                {sidebarPosition === "left" && (
                  <svg
                    className="absolute right-3 h-3.5 w-3.5 text-amber-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setSidebarPosition("right")}
                className={`group relative flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 transition-all duration-150 ${
                  sidebarPosition === "right"
                    ? "bg-stone-800 ring-1 ring-amber-500/50"
                    : "bg-stone-800/30 hover:bg-stone-800/60"
                }`}
              >
                {/* Mini layout preview */}
                <div className="flex h-6 w-10 overflow-hidden rounded border border-stone-600">
                  <div className="flex-1 bg-stone-900" />
                  <div
                    className={`w-3 transition-colors ${
                      sidebarPosition === "right"
                        ? "bg-amber-500/40"
                        : "bg-stone-700"
                    }`}
                  />
                </div>
                <span
                  className={`text-xs font-medium transition-colors ${
                    sidebarPosition === "right"
                      ? "text-stone-100"
                      : "text-stone-400 group-hover:text-stone-300"
                  }`}
                >
                  Right
                </span>
                {sidebarPosition === "right" && (
                  <svg
                    className="absolute right-3 h-3.5 w-3.5 text-amber-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Classification */}
          {claudeAvailable && (
            <div className="px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                <svg
                  className="h-4 w-4 text-stone-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                </svg>
                <span className="text-xs font-medium text-stone-300">
                  Classification
                </span>
              </div>

              {/* Auto-classify toggle */}
              <label className="flex items-center justify-between rounded-lg bg-stone-800/30 px-3 py-2.5 cursor-pointer hover:bg-stone-800/50 transition-colors">
                <span className="text-xs text-stone-300">
                  Auto-classify new hunks
                </span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={autoClassifyEnabled}
                    onChange={(e) => setAutoClassifyEnabled(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div
                    className={`h-5 w-9 rounded-full transition-colors ${
                      autoClassifyEnabled ? "bg-violet-500" : "bg-stone-600"
                    }`}
                  />
                  <div
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      autoClassifyEnabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </div>
              </label>

              {/* Classify command */}
              <div className="mt-3 space-y-1.5">
                <label className="text-xxs text-stone-500 uppercase tracking-wide">
                  Custom Command
                </label>
                <input
                  type="text"
                  value={classifyCommand || ""}
                  onChange={(e) => setClassifyCommand(e.target.value || null)}
                  placeholder="claude --print --model haiku -p"
                  className="w-full rounded-lg bg-stone-800/50 border border-stone-700 px-3 py-2 text-xs text-stone-200 placeholder-stone-600 focus:outline-none focus:border-violet-500/50 transition-colors"
                />
                <p className="text-xxs text-stone-600 leading-relaxed">
                  Leave blank for default. The prompt is appended as the last
                  argument.
                </p>
              </div>

              {/* Batch size */}
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xxs text-stone-500 uppercase tracking-wide">
                    Batch Size
                  </label>
                  <span className="text-xs font-mono text-stone-300">
                    {classifyBatchSize}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={classifyBatchSize}
                  onChange={(e) =>
                    setClassifyBatchSize(parseInt(e.target.value, 10))
                  }
                  className="w-full h-1.5 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
                <p className="text-xxs text-stone-600 leading-relaxed">
                  Hunks per Claude call. Higher values use fewer API calls but
                  may reduce accuracy.
                </p>
              </div>

              {/* Max concurrent */}
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xxs text-stone-500 uppercase tracking-wide">
                    Max Concurrent
                  </label>
                  <span className="text-xs font-mono text-stone-300">
                    {classifyMaxConcurrent}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={classifyMaxConcurrent}
                  onChange={(e) =>
                    setClassifyMaxConcurrent(parseInt(e.target.value, 10))
                  }
                  className="w-full h-1.5 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
                <p className="text-xxs text-stone-600 leading-relaxed">
                  Maximum parallel Claude processes. Lower values reduce system
                  load.
                </p>
              </div>
            </div>
          )}

          {/* Sync Server (iOS Companion) - Desktop only */}
          {isTauri && (
            <div className="px-5 py-4">
              <div className="mb-3 flex items-center gap-2">
                <svg
                  className="h-4 w-4 text-stone-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <path d="M12 18h.01" />
                </svg>
                <span className="text-xs font-medium text-stone-300">
                  iOS Companion
                </span>
                {syncServerRunning && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime-500/10 px-2 py-0.5 text-xxs font-medium text-lime-400 ring-1 ring-lime-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-lime-400 animate-pulse" />
                    Running
                  </span>
                )}
              </div>

              {/* Enable toggle */}
              <label className="flex items-center justify-between rounded-lg bg-stone-800/30 px-3 py-2.5 cursor-pointer hover:bg-stone-800/50 transition-colors">
                <span className="text-xs text-stone-300">
                  Enable sync server
                </span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={syncServerEnabled}
                    onChange={(e) => setSyncServerEnabled(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div
                    className={`h-5 w-9 rounded-full transition-colors ${
                      syncServerEnabled ? "bg-lime-500" : "bg-stone-600"
                    }`}
                  />
                  <div
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      syncServerEnabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </div>
              </label>

              {syncError && (
                <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                  <p className="text-xxs text-red-400">{syncError}</p>
                </div>
              )}

              {syncServerEnabled && (
                <>
                  {/* Connection info */}
                  {syncTailscaleIp ? (
                    <div className="mt-3 rounded-lg bg-stone-800/50 border border-stone-700 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xxs text-stone-500 uppercase tracking-wide">
                          Server URL
                        </span>
                        <button
                          onClick={handleCopyUrl}
                          className="text-xxs text-stone-500 hover:text-stone-300 transition-colors"
                        >
                          {urlCopied ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      <code className="block text-xs text-lime-400 font-mono">
                        http://{syncTailscaleIp}:{syncServerPort}
                      </code>
                      <p className="text-xxs text-stone-600">
                        Enter this URL in the iOS app to connect
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                      <p className="text-xxs text-amber-400">
                        Tailscale not detected. Install and connect Tailscale to
                        enable remote access.
                      </p>
                    </div>
                  )}

                  {/* Auth token */}
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xxs text-stone-500 uppercase tracking-wide">
                        Auth Token
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowToken(!showToken)}
                          className="text-xxs text-stone-500 hover:text-stone-300 transition-colors"
                        >
                          {showToken ? "Hide" : "Show"}
                        </button>
                        <button
                          onClick={handleCopyToken}
                          className="text-xxs text-stone-500 hover:text-stone-300 transition-colors"
                        >
                          {tokenCopied ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type={showToken ? "text" : "password"}
                        value={syncAuthToken || ""}
                        readOnly
                        className="flex-1 rounded-lg bg-stone-800/50 border border-stone-700 px-3 py-2 text-xs text-stone-200 font-mono focus:outline-none"
                      />
                      <button
                        onClick={regenerateAuthToken}
                        className="rounded-lg bg-stone-800 border border-stone-700 px-3 py-2 text-xs text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors"
                        title="Generate new token"
                      >
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                          <path d="M21 3v5h-5" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xxs text-stone-600 leading-relaxed">
                      Enter this token in the iOS app for authentication.
                      Regenerating will disconnect existing sessions.
                    </p>
                  </div>

                  {/* Port */}
                  <div className="mt-3 space-y-1.5">
                    <label className="text-xxs text-stone-500 uppercase tracking-wide">
                      Port
                    </label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={syncServerPort}
                      onChange={(e) => {
                        const port = parseInt(e.target.value, 10);
                        if (port >= 1024 && port <= 65535) {
                          setSyncServerPort(port);
                        }
                      }}
                      className="w-24 rounded-lg bg-stone-800/50 border border-stone-700 px-3 py-2 text-xs text-stone-200 font-mono focus:outline-none focus:border-lime-500/50 transition-colors"
                    />
                    <p className="text-xxs text-stone-600">
                      Changing the port requires restarting the server.
                    </p>
                  </div>
                </>
              )}

              <p className="mt-3 text-xxs text-stone-600 leading-relaxed">
                The sync server allows the iOS companion app to view and modify
                review state. Requires Tailscale for secure connectivity.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-stone-800 bg-stone-900/50 px-5 py-3">
          <p className="text-center text-xxs text-stone-600">
            Settings are saved automatically
          </p>
        </div>
      </div>
    </div>
  );
}
