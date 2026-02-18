/**
 * Bundled UI themes for the Review app.
 *
 * Each theme provides values for every semantic CSS variable defined in index.css.
 * Applying a theme sets these variables on `document.documentElement`, overriding
 * the defaults from the `@theme extend` block.
 *
 * The `colorScheme` property controls `color-scheme` on `<html>`, which affects
 * native controls (scrollbars, form inputs, selection) and CSS system colors.
 */

export interface UiTheme {
  id: string;
  label: string;
  colorScheme: "dark" | "light";
  /** Preview swatches shown in the theme picker [bg, fg, accent] */
  preview: [string, string, string];
  /** Recommended code (Shiki) theme to pair with this UI theme */
  codeTheme: string;
  tokens: UiThemeTokens;
}

export interface UiThemeTokens {
  // Surfaces
  surface: string;
  "surface-inset": string;
  "surface-panel": string;
  "surface-raised": string;
  "surface-overlay": string;
  "surface-hover": string;
  "surface-active": string;

  // Foreground
  fg: string;
  "fg-secondary": string;
  "fg-muted": string;
  "fg-faint": string;

  // Borders
  edge: string;
  "edge-default": string;
  "edge-strong": string;

  // Interactive
  "focus-ring": string;
  selection: string;
  link: string;

  // Status — review
  "status-approved": string;
  "status-trusted": string;
  "status-rejected": string;
  "status-pending": string;
  "status-saved": string;
  guide: string;

  // Status — file
  "status-added": string;
  "status-modified": string;
  "status-deleted": string;
  "status-renamed": string;
  "status-untracked": string;
  "status-moved": string;

  // Status — UI
  "status-warning": string;
  "status-info": string;

  // Diff
  "diff-added": string;
  "diff-removed": string;
}

// ---------------------------------------------------------------------------
// Bundled themes
// ---------------------------------------------------------------------------

const DARK_DEFAULT_TOKENS: UiThemeTokens = {
  surface: "#0c0a09",
  "surface-inset": "#1c1917",
  "surface-panel": "#1c1917",
  "surface-raised": "#292524",
  "surface-overlay": "#292524",
  "surface-hover": "#44403c",
  "surface-active": "#57534e",
  fg: "#fafaf9",
  "fg-secondary": "#d6d3d1",
  "fg-muted": "#a19d99",
  "fg-faint": "#918d89",
  edge: "rgba(168, 162, 158, 0.15)",
  "edge-default": "rgba(168, 162, 158, 0.25)",
  "edge-strong": "rgba(168, 162, 158, 0.4)",
  "focus-ring": "#d9923a",
  selection: "rgba(59, 130, 246, 0.3)",
  link: "#22d3ee",
  "status-approved": "#34d399",
  "status-trusted": "#2dd4bf",
  "status-rejected": "#fb7185",
  "status-pending": "#a8a29e",
  "status-saved": "#fbbf24",
  guide: "#a78bfa",
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

export const UI_THEMES: UiTheme[] = [
  {
    id: "review-dark",
    label: "Review Dark",
    colorScheme: "dark",
    preview: ["#0c0a09", "#d6d3d1", "#d9923a"],
    codeTheme: "github-dark",
    tokens: DARK_DEFAULT_TOKENS,
  },
  {
    id: "review-light",
    label: "Review Light",
    colorScheme: "light",
    preview: ["#fafaf9", "#292524", "#b45309"],
    codeTheme: "github-light",
    tokens: {
      surface: "#fafaf9",
      "surface-inset": "#f5f5f4",
      "surface-panel": "#f5f5f4",
      "surface-raised": "#e7e5e4",
      "surface-overlay": "#ffffff",
      "surface-hover": "#d6d3d1",
      "surface-active": "#a8a29e",
      fg: "#1c1917",
      "fg-secondary": "#292524",
      "fg-muted": "#57534e",
      "fg-faint": "#78716c",
      edge: "rgba(41, 37, 36, 0.12)",
      "edge-default": "rgba(41, 37, 36, 0.2)",
      "edge-strong": "rgba(41, 37, 36, 0.35)",
      "focus-ring": "#b45309",
      selection: "rgba(59, 130, 246, 0.2)",
      link: "#0891b2",
      "status-approved": "#059669",
      "status-trusted": "#0d9488",
      "status-rejected": "#e11d48",
      "status-pending": "#78716c",
      "status-saved": "#d97706",
      guide: "#7c3aed",
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
    },
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    colorScheme: "dark",
    preview: ["#0d1117", "#c9d1d9", "#58a6ff"],
    codeTheme: "github-dark",
    tokens: {
      ...DARK_DEFAULT_TOKENS,
      surface: "#0d1117",
      "surface-inset": "#010409",
      "surface-panel": "#161b22",
      "surface-raised": "#21262d",
      "surface-overlay": "#30363d",
      "surface-hover": "#30363d",
      "surface-active": "#484f58",
      fg: "#f0f6fc",
      "fg-secondary": "#c9d1d9",
      "fg-muted": "#8b949e",
      "fg-faint": "#6e7681",
      edge: "rgba(240, 246, 252, 0.1)",
      "edge-default": "#30363d",
      "edge-strong": "#484f58",
      "focus-ring": "#58a6ff",
      link: "#58a6ff",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    colorScheme: "dark",
    preview: ["#282a36", "#f8f8f2", "#bd93f9"],
    codeTheme: "dracula",
    tokens: {
      ...DARK_DEFAULT_TOKENS,
      surface: "#282a36",
      "surface-inset": "#21222c",
      "surface-panel": "#21222c",
      "surface-raised": "#343746",
      "surface-overlay": "#3e4152",
      "surface-hover": "#44475a",
      "surface-active": "#6272a4",
      fg: "#f8f8f2",
      "fg-secondary": "#e2e2dc",
      "fg-muted": "#8c8ea0",
      "fg-faint": "#6272a4",
      edge: "rgba(248, 248, 242, 0.08)",
      "edge-default": "rgba(248, 248, 242, 0.15)",
      "edge-strong": "rgba(248, 248, 242, 0.25)",
      "focus-ring": "#bd93f9",
      link: "#8be9fd",
      "status-approved": "#50fa7b",
      "status-rejected": "#ff5555",
      guide: "#bd93f9",
      "status-modified": "#ffb86c",
      "status-renamed": "#8be9fd",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    colorScheme: "dark",
    preview: ["#1a1b26", "#c0caf5", "#7aa2f7"],
    codeTheme: "tokyo-night",
    tokens: {
      ...DARK_DEFAULT_TOKENS,
      surface: "#1a1b26",
      "surface-inset": "#16161e",
      "surface-panel": "#16161e",
      "surface-raised": "#24283b",
      "surface-overlay": "#292e42",
      "surface-hover": "#33394e",
      "surface-active": "#414868",
      fg: "#c0caf5",
      "fg-secondary": "#a9b1d6",
      "fg-muted": "#565f89",
      "fg-faint": "#3b4261",
      edge: "rgba(192, 202, 245, 0.08)",
      "edge-default": "rgba(192, 202, 245, 0.15)",
      "edge-strong": "rgba(192, 202, 245, 0.25)",
      "focus-ring": "#7aa2f7",
      link: "#7dcfff",
      "status-approved": "#9ece6a",
      "status-rejected": "#f7768e",
      guide: "#bb9af7",
      "status-modified": "#e0af68",
      "status-renamed": "#7dcfff",
    },
  },
  {
    id: "nord",
    label: "Nord",
    colorScheme: "dark",
    preview: ["#2e3440", "#eceff4", "#88c0d0"],
    codeTheme: "nord",
    tokens: {
      ...DARK_DEFAULT_TOKENS,
      surface: "#2e3440",
      "surface-inset": "#272c36",
      "surface-panel": "#2e3440",
      "surface-raised": "#3b4252",
      "surface-overlay": "#434c5e",
      "surface-hover": "#434c5e",
      "surface-active": "#4c566a",
      fg: "#eceff4",
      "fg-secondary": "#d8dee9",
      "fg-muted": "#81a1c1",
      "fg-faint": "#4c566a",
      edge: "rgba(236, 239, 244, 0.08)",
      "edge-default": "rgba(236, 239, 244, 0.15)",
      "edge-strong": "rgba(236, 239, 244, 0.25)",
      "focus-ring": "#88c0d0",
      link: "#88c0d0",
      "status-approved": "#a3be8c",
      "status-rejected": "#bf616a",
      guide: "#b48ead",
      "status-modified": "#ebcb8b",
      "status-renamed": "#88c0d0",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    colorScheme: "dark",
    preview: ["#002b36", "#839496", "#268bd2"],
    codeTheme: "solarized-dark",
    tokens: {
      ...DARK_DEFAULT_TOKENS,
      surface: "#002b36",
      "surface-inset": "#00212b",
      "surface-panel": "#073642",
      "surface-raised": "#073642",
      "surface-overlay": "#0a4050",
      "surface-hover": "#0a4050",
      "surface-active": "#586e75",
      fg: "#fdf6e3",
      "fg-secondary": "#eee8d5",
      "fg-muted": "#839496",
      "fg-faint": "#586e75",
      edge: "rgba(131, 148, 150, 0.15)",
      "edge-default": "rgba(131, 148, 150, 0.25)",
      "edge-strong": "rgba(131, 148, 150, 0.4)",
      "focus-ring": "#268bd2",
      link: "#268bd2",
      "status-approved": "#859900",
      "status-rejected": "#dc322f",
      guide: "#6c71c4",
      "status-modified": "#b58900",
      "status-renamed": "#268bd2",
    },
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    colorScheme: "light",
    preview: ["#fdf6e3", "#586e75", "#268bd2"],
    codeTheme: "solarized-light",
    tokens: {
      surface: "#fdf6e3",
      "surface-inset": "#eee8d5",
      "surface-panel": "#eee8d5",
      "surface-raised": "#e4ddc8",
      "surface-overlay": "#fdf6e3",
      "surface-hover": "#e4ddc8",
      "surface-active": "#d3cbb7",
      fg: "#002b36",
      "fg-secondary": "#073642",
      "fg-muted": "#586e75",
      "fg-faint": "#93a1a1",
      edge: "rgba(88, 110, 117, 0.12)",
      "edge-default": "rgba(88, 110, 117, 0.2)",
      "edge-strong": "rgba(88, 110, 117, 0.35)",
      "focus-ring": "#268bd2",
      selection: "rgba(38, 139, 210, 0.2)",
      link: "#268bd2",
      "status-approved": "#859900",
      "status-trusted": "#2aa198",
      "status-rejected": "#dc322f",
      "status-pending": "#93a1a1",
      "status-saved": "#b58900",
      guide: "#6c71c4",
      "status-added": "#859900",
      "status-modified": "#b58900",
      "status-deleted": "#dc322f",
      "status-renamed": "#268bd2",
      "status-untracked": "#859900",
      "status-moved": "#268bd2",
      "status-warning": "#b58900",
      "status-info": "#268bd2",
      "diff-added": "#5a9e6f",
      "diff-removed": "#c9584c",
    },
  },
];

// ---------------------------------------------------------------------------
// Custom themes
// ---------------------------------------------------------------------------

let customThemes: UiTheme[] = [];

/**
 * Register custom themes (loaded from settings.json).
 * Each definition is a VS Code-style theme JSON object with name, type, colors, tokenColors.
 */
export function setCustomThemes(
  defs: Array<{
    name: string;
    type: string;
    colors: Record<string, string>;
    tokenColors: unknown[];
  }>,
): void {
  // Lazy-import to avoid circular dependency (resolveVscodeTheme imports from ui-themes)
  import("./vscode-theme-resolver")
    .then(({ resolveVscodeTheme }) => {
      customThemes = defs.map((def) =>
        resolveVscodeTheme({
          name: def.name,
          themeType: def.type,
          colors: def.colors,
          tokenColors: def.tokenColors,
        }),
      );
    })
    .catch((err) => {
      console.warn("[ui-themes] Failed to load custom themes:", err);
    });
}

/**
 * Return all themes: bundled + custom.
 */
export function getAllUiThemes(): UiTheme[] {
  return [...UI_THEMES, ...customThemes];
}

// ---------------------------------------------------------------------------
// Theme application
// ---------------------------------------------------------------------------

const TOKEN_TO_CSS_VAR: Record<keyof UiThemeTokens, string> = {
  surface: "--color-surface",
  "surface-inset": "--color-surface-inset",
  "surface-panel": "--color-surface-panel",
  "surface-raised": "--color-surface-raised",
  "surface-overlay": "--color-surface-overlay",
  "surface-hover": "--color-surface-hover",
  "surface-active": "--color-surface-active",
  fg: "--color-fg",
  "fg-secondary": "--color-fg-secondary",
  "fg-muted": "--color-fg-muted",
  "fg-faint": "--color-fg-faint",
  edge: "--color-edge",
  "edge-default": "--color-edge-default",
  "edge-strong": "--color-edge-strong",
  "focus-ring": "--color-focus-ring",
  selection: "--color-selection",
  link: "--color-link",
  "status-approved": "--color-status-approved",
  "status-trusted": "--color-status-trusted",
  "status-rejected": "--color-status-rejected",
  "status-pending": "--color-status-pending",
  "status-saved": "--color-status-saved",
  guide: "--color-guide",
  "status-added": "--color-status-added",
  "status-modified": "--color-status-modified",
  "status-deleted": "--color-status-deleted",
  "status-renamed": "--color-status-renamed",
  "status-untracked": "--color-status-untracked",
  "status-moved": "--color-status-moved",
  "status-warning": "--color-status-warning",
  "status-info": "--color-status-info",
  "diff-added": "--color-diff-added",
  "diff-removed": "--color-diff-removed",
};

/**
 * Apply a UI theme by setting CSS custom properties on `<html>`.
 * Also sets `color-scheme` for native controls.
 */
export function applyUiTheme(theme: UiTheme): void {
  const el = document.documentElement;
  el.style.setProperty("color-scheme", theme.colorScheme);

  for (const [token, value] of Object.entries(theme.tokens)) {
    const cssVar = TOKEN_TO_CSS_VAR[token as keyof UiThemeTokens];
    if (cssVar) {
      el.style.setProperty(cssVar, value);
    }
  }
}

/**
 * Remove all theme overrides, reverting to CSS defaults.
 */
export function clearUiTheme(): void {
  const el = document.documentElement;
  el.style.removeProperty("color-scheme");

  for (const cssVar of Object.values(TOKEN_TO_CSS_VAR)) {
    el.style.removeProperty(cssVar);
  }
}

/**
 * Find a theme by ID (searches bundled and custom). Returns the default dark theme if not found.
 */
export function getUiTheme(id: string): UiTheme {
  return getAllUiThemes().find((t) => t.id === id) ?? UI_THEMES[0];
}
