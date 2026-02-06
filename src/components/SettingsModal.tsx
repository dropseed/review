import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useReviewStore } from "../stores";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "../utils/preferences";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { SimpleTooltip } from "./ui/tooltip";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";

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
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const setCodeFontSize = useReviewStore((s) => s.setCodeFontSize);
  const codeTheme = useReviewStore((s) => s.codeTheme);
  const setCodeTheme = useReviewStore((s) => s.setCodeTheme);
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);
  const autoClassifyEnabled = useReviewStore((s) => s.autoClassifyEnabled);
  const setAutoClassifyEnabled = useReviewStore(
    (s) => s.setAutoClassifyEnabled,
  );
  const classifyCommand = useReviewStore((s) => s.classifyCommand);
  const setClassifyCommand = useReviewStore((s) => s.setClassifyCommand);
  const classifyBatchSize = useReviewStore((s) => s.classifyBatchSize);
  const setClassifyBatchSize = useReviewStore((s) => s.setClassifyBatchSize);
  const classifyMaxConcurrent = useReviewStore((s) => s.classifyMaxConcurrent);
  const setClassifyMaxConcurrent = useReviewStore(
    (s) => s.setClassifyMaxConcurrent,
  );
  const sentryEnabled = useReviewStore((s) => s.sentryEnabled);
  const setSentryEnabled = useReviewStore((s) => s.setSentryEnabled);
  const soundEffectsEnabled = useReviewStore((s) => s.soundEffectsEnabled);
  const setSoundEffectsEnabled = useReviewStore(
    (s) => s.setSoundEffectsEnabled,
  );

  // CLI install status (hidden in dev mode)
  const [devMode, setDevMode] = useState(false);
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliSymlinkTarget, setCliSymlinkTarget] = useState<string | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliLoading, setCliLoading] = useState(false);

  const refreshCliStatus = useCallback(async () => {
    try {
      const isDev = await invoke<boolean>("is_dev_mode");
      setDevMode(isDev);
      if (isDev) return;

      const status = await invoke<{
        installed: boolean;
        symlink_target: string | null;
      }>("get_cli_install_status");
      setCliInstalled(status.installed);
      setCliSymlinkTarget(status.symlink_target);
    } catch {
      // Ignore errors checking status
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshCliStatus();
    }
  }, [isOpen, refreshCliStatus]);

  const handleInstallCli = async () => {
    setCliLoading(true);
    setCliError(null);
    try {
      await invoke("install_cli");
      await refreshCliStatus();
    } catch (e) {
      setCliError(String(e));
    } finally {
      setCliLoading(false);
    }
  };

  const handleUninstallCli = async () => {
    setCliLoading(true);
    setCliError(null);
    try {
      await invoke("uninstall_cli");
      await refreshCliStatus();
    } catch (e) {
      setCliError(String(e));
    } finally {
      setCliLoading(false);
    }
  };

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex w-full max-w-md max-h-[85vh] flex-col rounded-xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="relative px-5 py-4">
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-teal-500/5" />
          <div className="relative flex items-center gap-3">
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
            <DialogTitle>Settings</DialogTitle>
          </div>
          <button
            onClick={onClose}
            className="relative rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
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
        </DialogHeader>

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
                <SimpleTooltip content="Decrease font size (Cmd+-)">
                  <button
                    onClick={decreaseFontSize}
                    disabled={codeFontSize <= CODE_FONT_SIZE_MIN}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-700/50 text-stone-300 transition-colors hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed"
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
                </SimpleTooltip>

                {/* Current size display */}
                <div className="flex min-w-[5.5rem] flex-col items-center px-3">
                  <span className="font-mono text-lg font-semibold text-stone-100 tabular-nums">
                    {codeFontSize}px
                  </span>
                </div>

                {/* Increase button */}
                <SimpleTooltip content="Increase font size (Cmd++)">
                  <button
                    onClick={increaseFontSize}
                    disabled={codeFontSize >= CODE_FONT_SIZE_MAX}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-stone-700/50 text-stone-300 transition-colors hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed"
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
                </SimpleTooltip>
              </div>

              {/* Reset button */}
              {codeFontSize !== CODE_FONT_SIZE_DEFAULT && (
                <SimpleTooltip content="Reset to default (Cmd+0)">
                  <button
                    onClick={resetFontSize}
                    className="text-xxs text-stone-500 hover:text-stone-300 transition-colors"
                  >
                    Reset
                  </button>
                </SimpleTooltip>
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
                <span className="text-xs text-stone-300">AI auto-classify</span>
                <Switch
                  checked={autoClassifyEnabled}
                  onCheckedChange={setAutoClassifyEnabled}
                />
              </label>

              {/* Classify command */}
              <div className="mt-3 space-y-1.5">
                <label className="text-xxs text-stone-500 uppercase tracking-wide">
                  Custom Command
                </label>
                <Input
                  type="text"
                  value={classifyCommand || ""}
                  onChange={(e) => setClassifyCommand(e.target.value || null)}
                  placeholder="claude --print --model haiku -p"
                  className="text-xs"
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
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  value={[classifyBatchSize]}
                  onValueChange={([val]) => setClassifyBatchSize(val)}
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
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={[classifyMaxConcurrent]}
                  onValueChange={([val]) => setClassifyMaxConcurrent(val)}
                />
                <p className="text-xxs text-stone-600 leading-relaxed">
                  Maximum parallel Claude processes. Lower values reduce system
                  load.
                </p>
              </div>
            </div>
          )}

          {/* Command Line (hidden in dev mode) */}
          {!devMode && (
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
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span className="text-xs font-medium text-stone-300">
                  Command Line
                </span>
              </div>

              {cliInstalled ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-stone-800/30 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="text-xs text-stone-300">
                          Installed at{" "}
                          <code className="text-xxs text-stone-500">
                            /usr/local/bin/review
                          </code>
                        </span>
                      </div>
                      {cliSymlinkTarget && (
                        <p className="mt-1 truncate pl-3.5 text-xxs text-stone-600">
                          {cliSymlinkTarget}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleUninstallCli}
                      disabled={cliLoading}
                      className="ml-3 shrink-0 rounded-md px-2.5 py-1.5 text-xxs text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300 disabled:opacity-50"
                    >
                      Uninstall
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-stone-800/30 px-3 py-2.5">
                    <span className="text-xs text-stone-400">
                      <code className="text-xxs">review</code> command not
                      installed
                    </span>
                    <button
                      onClick={handleInstallCli}
                      disabled={cliLoading}
                      className="ml-3 shrink-0 rounded-md bg-stone-700/50 px-2.5 py-1.5 text-xxs text-stone-300 transition-colors hover:bg-stone-700 disabled:opacity-50"
                    >
                      {cliLoading ? "Installing..." : "Install"}
                    </button>
                  </div>
                  <p className="text-xxs text-stone-600 leading-relaxed">
                    Creates a symlink at{" "}
                    <code className="text-stone-500">
                      /usr/local/bin/review
                    </code>{" "}
                    so you can run{" "}
                    <code className="text-stone-500">review</code> from any
                    terminal.
                  </p>
                </div>
              )}

              {cliError && (
                <div className="mt-2 rounded-lg bg-red-950/30 px-3 py-2 ring-1 ring-red-900/30">
                  <p className="whitespace-pre-wrap text-xxs text-red-400/90">
                    {cliError}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Sound Effects */}
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
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
              <span className="text-xs font-medium text-stone-300">
                Sound Effects
              </span>
            </div>

            <label className="flex items-center justify-between rounded-lg bg-stone-800/30 px-3 py-2.5 cursor-pointer hover:bg-stone-800/50 transition-colors">
              <span className="text-xs text-stone-300">
                Enable sound effects
              </span>
              <Switch
                checked={soundEffectsEnabled}
                onCheckedChange={setSoundEffectsEnabled}
              />
            </label>
            <p className="mt-2 text-xxs text-stone-600 leading-relaxed">
              Play sounds when approving, rejecting, and completing reviews.
            </p>
          </div>

          {/* Crash Reporting */}
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
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-xs font-medium text-stone-300">
                Crash Reporting
              </span>
            </div>

            <label className="flex items-center justify-between rounded-lg bg-stone-800/30 px-3 py-2.5 cursor-pointer hover:bg-stone-800/50 transition-colors">
              <span className="text-xs text-stone-300">Send crash reports</span>
              <Switch
                checked={sentryEnabled}
                onCheckedChange={setSentryEnabled}
              />
            </label>
            <p className="mt-2 text-xxs text-stone-600 leading-relaxed">
              When enabled, anonymous crash reports are sent to help improve
              Review. Only app errors, version, and OS info are included. No
              repository data or file contents are ever sent.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-stone-800 bg-stone-900/50 px-5 py-3">
          <p className="text-center text-xxs text-stone-600">
            Settings are saved automatically
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
