import { useReviewStore } from "../stores/reviewStore";
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
  } = useReviewStore();

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
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-lime-500/5" />
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
