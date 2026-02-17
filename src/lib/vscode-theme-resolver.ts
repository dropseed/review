/**
 * Resolves VS Code themes into our UiTheme format.
 *
 * Two resolution strategies:
 * 1. Match a VS Code theme name to a bundled UiTheme (fast, exact match)
 * 2. Parse a VS Code theme JSON and generate a UiTheme from its colors (flexible)
 */

import { registerCustomTheme } from "@pierre/diffs";
import type { UiTheme, UiThemeTokens } from "./ui-themes";
import { UI_THEMES } from "./ui-themes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of VS Code theme JSON we care about */
export interface VscodeThemeJson {
  name?: string;
  type?: "dark" | "light" | "hc";
  colors?: Record<string, string>;
}

/** Result from the Rust `detect_vscode_theme` command */
export interface VscodeThemeDetection {
  name: string;
  themeType: string; // "dark" | "light" | "hc"
  colors: Record<string, string>;
  /** Raw tokenColors array from the VS Code theme (for Shiki syntax highlighting) */
  tokenColors: unknown[];
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Look up a value from a name-mapping table, trying exact match first,
 * then case-insensitive, then optional partial match (name contains key).
 */
function lookupByName(
  map: Record<string, string>,
  name: string,
  allowPartial = false,
): string | null {
  const exact = map[name];
  if (exact) return exact;

  const lower = name.toLowerCase();

  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === lower) return value;
  }

  if (allowPartial) {
    for (const [key, value] of Object.entries(map)) {
      if (lower.includes(key.toLowerCase())) return value;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bundled theme matching (fast path)
// ---------------------------------------------------------------------------

/**
 * Well-known VS Code theme names → our bundled theme IDs.
 * Case-sensitive exact match is tried first, then case-insensitive.
 */
const VSCODE_TO_BUNDLED: Record<string, string> = {
  // Dark defaults
  "Default Dark+": "review-dark",
  "Default Dark Modern": "review-dark",
  "Visual Studio Dark": "review-dark",
  // GitHub
  "GitHub Dark": "github-dark",
  "GitHub Dark Default": "github-dark",
  "GitHub Dark Dimmed": "github-dark",
  // Dracula
  Dracula: "dracula",
  "Dracula Soft": "dracula",
  "Dracula Theme": "dracula",
  // Tokyo Night
  "Tokyo Night": "tokyo-night",
  "Tokyo Night Storm": "tokyo-night",
  // Nord
  Nord: "nord",
  "Nord Deep": "nord",
  // Solarized
  "Solarized Dark": "solarized-dark",
  "Solarized Light": "solarized-light",
  // Light defaults
  "Default Light+": "review-light",
  "Default Light Modern": "review-light",
  "Visual Studio Light": "review-light",
  "GitHub Light": "review-light",
  "GitHub Light Default": "review-light",
};

/**
 * Try to match a VS Code theme name to one of our bundled themes.
 */
export function matchBundledTheme(vscodeName: string): UiTheme | null {
  const id = lookupByName(VSCODE_TO_BUNDLED, vscodeName);
  if (!id) return null;
  return UI_THEMES.find((t) => t.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// VS Code color → UiThemeTokens mapping
// ---------------------------------------------------------------------------

/**
 * Maps each token to a prioritized list of VS Code color keys.
 * First match wins for each token.
 */
const COLOR_MAP: [keyof UiThemeTokens, string[]][] = [
  // Surfaces
  ["surface", ["editor.background"]],
  ["surface-inset", ["editorGroupHeader.tabsBackground", "sideBar.background"]],
  ["surface-panel", ["sideBar.background", "panel.background"]],
  ["surface-raised", ["editorWidget.background", "tab.activeBackground"]],
  ["surface-overlay", ["editorWidget.background", "menu.background"]],
  ["surface-hover", ["list.hoverBackground", "toolbar.hoverBackground"]],
  ["surface-active", ["list.activeSelectionBackground"]],

  // Foreground
  ["fg", ["editor.foreground", "foreground"]],
  ["fg-secondary", ["sideBar.foreground", "descriptionForeground"]],
  ["fg-muted", ["tab.inactiveForeground", "editorLineNumber.foreground"]],
  ["fg-faint", ["editorLineNumber.foreground", "editorWhitespace.foreground"]],

  // Borders
  ["edge", ["panel.border", "editorGroup.border"]],
  ["edge-default", ["sideBar.border", "tab.border"]],
  ["edge-strong", ["contrastBorder", "contrastActiveBorder"]],

  // Interactive
  ["focus-ring", ["focusBorder", "button.background"]],
  ["selection", ["editor.selectionBackground"]],
  ["link", ["textLink.foreground", "editorLink.activeForeground"]],

  // Diff
  [
    "diff-added",
    [
      "diffEditor.insertedTextBackground",
      "gitDecoration.addedResourceForeground",
    ],
  ],
  [
    "diff-removed",
    [
      "diffEditor.removedTextBackground",
      "gitDecoration.deletedResourceForeground",
    ],
  ],
];

// ---------------------------------------------------------------------------
// Shiki theme resolution
// ---------------------------------------------------------------------------

/**
 * Well-known VS Code theme names → Shiki bundled theme names.
 */
const VSCODE_TO_SHIKI: Record<string, string> = {
  // Defaults
  "Default Dark+": "dark-plus",
  "Default Dark Modern": "dark-plus",
  "Default Light+": "light-plus",
  "Default Light Modern": "light-plus",
  "Visual Studio Dark": "dark-plus",
  "Visual Studio Light": "light-plus",
  // GitHub
  "GitHub Dark": "github-dark",
  "GitHub Dark Default": "github-dark",
  "GitHub Dark Dimmed": "github-dark-dimmed",
  "GitHub Light": "github-light",
  "GitHub Light Default": "github-light",
  // Popular
  Dracula: "dracula",
  "Dracula Soft": "dracula-soft",
  "Tokyo Night": "tokyo-night",
  Nord: "nord",
  "Solarized Dark": "solarized-dark",
  "Solarized Light": "solarized-light",
  Monokai: "monokai",
  "One Dark Pro": "one-dark-pro",
  "Vitesse Dark": "vitesse-dark",
  "Vitesse Light": "vitesse-light",
  "Catppuccin Mocha": "catppuccin-mocha",
  "Catppuccin Latte": "catppuccin-latte",
  "Night Owl": "night-owl",
  "Rose Pine": "rose-pine",
  "Rose Pine Moon": "rose-pine-moon",
  "Rose Pine Dawn": "rose-pine-dawn",
  "Min Dark": "min-dark",
  "Min Light": "min-light",
  Poimandres: "poimandres",
  "Ayu Dark": "ayu-dark",
};

/** Try to find a matching Shiki bundled theme name. Returns null if none found. */
function findShikiTheme(vscodeName: string): string | null {
  return lookupByName(VSCODE_TO_SHIKI, vscodeName, true);
}

/**
 * If the detection has tokenColors, register a custom Shiki theme and return
 * its ID. Returns null if there are no tokenColors to register.
 */
function registerCustomShikiTheme(
  themeId: string,
  detection: VscodeThemeDetection,
  isDark: boolean,
): string | null {
  if (detection.tokenColors.length === 0) return null;

  const fg =
    detection.colors["editor.foreground"] || (isDark ? "#d4d4d4" : "#1e1e1e");
  const bg =
    detection.colors["editor.background"] || (isDark ? "#1e1e1e" : "#ffffff");

  registerCustomTheme(themeId, async () => ({
    name: themeId,
    type: isDark ? "dark" : "light",
    fg,
    bg,
    settings: detection.tokenColors as Array<{
      scope?: string | string[];
      settings: Record<string, string>;
    }>,
  }));

  return themeId;
}

// ---------------------------------------------------------------------------
// Fallback token defaults
// ---------------------------------------------------------------------------

const DARK_FALLBACK_TOKENS: UiThemeTokens = {
  surface: "#1e1e1e",
  "surface-inset": "#252526",
  "surface-panel": "#252526",
  "surface-raised": "#333333",
  "surface-overlay": "#3c3c3c",
  "surface-hover": "#2a2d2e",
  "surface-active": "#094771",
  fg: "#d4d4d4",
  "fg-secondary": "#cccccc",
  "fg-muted": "#858585",
  "fg-faint": "#5a5a5a",
  edge: "rgba(128, 128, 128, 0.15)",
  "edge-default": "rgba(128, 128, 128, 0.25)",
  "edge-strong": "rgba(128, 128, 128, 0.4)",
  "focus-ring": "#007fd4",
  selection: "rgba(38, 79, 120, 0.5)",
  link: "#3794ff",
  "status-approved": "#34d399",
  "status-trusted": "#2dd4bf",
  "status-rejected": "#fb7185",
  "status-pending": "#a8a29e",
  "status-saved": "#fbbf24",
  "status-classifying": "#a78bfa",
  "status-added": "#34d399",
  "status-modified": "#fbbf24",
  "status-deleted": "#fb7185",
  "status-renamed": "#38bdf8",
  "status-untracked": "#34d399",
  "status-moved": "#38bdf8",
  "status-warning": "#fbbf24",
  "status-info": "#38bdf8",
  "diff-added": "#7aad8a",
  "diff-removed": "#e0776b",
};

const LIGHT_FALLBACK_TOKENS: UiThemeTokens = {
  surface: "#ffffff",
  "surface-inset": "#f3f3f3",
  "surface-panel": "#f3f3f3",
  "surface-raised": "#e8e8e8",
  "surface-overlay": "#ffffff",
  "surface-hover": "#e8e8e8",
  "surface-active": "#0060c0",
  fg: "#1e1e1e",
  "fg-secondary": "#3b3b3b",
  "fg-muted": "#616161",
  "fg-faint": "#999999",
  edge: "rgba(0, 0, 0, 0.12)",
  "edge-default": "rgba(0, 0, 0, 0.2)",
  "edge-strong": "rgba(0, 0, 0, 0.35)",
  "focus-ring": "#0066b8",
  selection: "rgba(173, 214, 255, 0.5)",
  link: "#006ab1",
  "status-approved": "#059669",
  "status-trusted": "#0d9488",
  "status-rejected": "#e11d48",
  "status-pending": "#78716c",
  "status-saved": "#d97706",
  "status-classifying": "#7c3aed",
  "status-added": "#059669",
  "status-modified": "#d97706",
  "status-deleted": "#e11d48",
  "status-renamed": "#0284c7",
  "status-untracked": "#059669",
  "status-moved": "#0284c7",
  "status-warning": "#d97706",
  "status-info": "#0284c7",
  "diff-added": "#5a9e6f",
  "diff-removed": "#c9584c",
};

// ---------------------------------------------------------------------------
// Theme generation
// ---------------------------------------------------------------------------

/**
 * Parse a VS Code theme detection result and generate a UiTheme.
 * Uses VS Code `colors` to fill our semantic tokens, falling back to
 * theme-appropriate defaults for any missing color.
 */
export function resolveVscodeTheme(detection: VscodeThemeDetection): UiTheme {
  const isDark = detection.themeType !== "light";
  const fallbacks = isDark ? DARK_FALLBACK_TOKENS : LIGHT_FALLBACK_TOKENS;

  // Start with all fallback tokens, then override with VS Code colors
  const tokens: UiThemeTokens = { ...fallbacks };

  for (const [token, vscodeKeys] of COLOR_MAP) {
    for (const key of vscodeKeys) {
      const value = detection.colors[key];
      if (value) {
        tokens[token] = value;
        break;
      }
    }
  }

  const themeId = `vscode-${detection.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const codeTheme =
    findShikiTheme(detection.name) ??
    registerCustomShikiTheme(themeId, detection, isDark) ??
    (isDark ? "github-dark" : "github-light");

  return {
    id: themeId,
    label: detection.name,
    colorScheme: isDark ? "dark" : "light",
    preview: [tokens.surface, tokens["fg-secondary"], tokens["focus-ring"]],
    codeTheme,
    tokens,
  };
}
