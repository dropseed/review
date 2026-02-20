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

import { registerCustomTheme } from "@pierre/diffs";

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
  "status-trusted": "#60a5fa",
  "status-rejected": "#fb7185",
  "status-pending": "#fb923c",
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

// ---------------------------------------------------------------------------
// Flexoki Shiki code themes (registered from upstream VS Code tokenColors)
// ---------------------------------------------------------------------------

const FLEXOKI_DARK_TOKEN_COLORS = [
  {
    scope: ["source", "support.type.property-name.css"],
    settings: { foreground: "#CECDC3" },
  },
  { scope: ["entity.name.type.class"], settings: { foreground: "#DA702C" } },
  {
    scope: ["entity.name.type.interface", "entity.name.type"],
    settings: { foreground: "#D0A215" },
  },
  { scope: ["entity.name.type.struct"], settings: { foreground: "#DA702C" } },
  { scope: ["entity.name.type.enum"], settings: { foreground: "#DA702C" } },
  {
    scope: ["meta.object-literal.key", "support.type.property-name"],
    settings: { foreground: "#DA702C" },
  },
  {
    scope: ["entity.name.function.method", "meta.function.method"],
    settings: { foreground: "#879A39" },
  },
  {
    scope: [
      "entity.name.function",
      "support.function",
      "meta.function-call.generic",
    ],
    settings: { foreground: "#DA702C", fontStyle: "bold" },
  },
  {
    scope: ["variable", "meta.variable", "variable.other.object.property"],
    settings: { foreground: "#CECDC3" },
  },
  {
    scope: ["variable.other.object", "variable.other.readwrite.alias"],
    settings: { foreground: "#879A39" },
  },
  {
    scope: ["variable.other.global", "variable.language.this"],
    settings: { foreground: "#CE5D97" },
  },
  { scope: ["variable.other.local"], settings: { foreground: "#282726" } },
  {
    scope: ["variable.parameter", "meta.parameter"],
    settings: { foreground: "#CECDC3" },
  },
  {
    scope: ["variable.other.property", "meta.property"],
    settings: { foreground: "#4385BE" },
  },
  {
    scope: ["string", "string.other.link", "markup.inline.raw.string.markdown"],
    settings: { foreground: "#3AA99F" },
  },
  {
    scope: ["constant.character.escape", "constant.other.placeholder"],
    settings: { foreground: "#CECDC3" },
  },
  { scope: ["keyword"], settings: { foreground: "#879A39" } },
  {
    scope: ["keyword.control.import", "keyword.control.from", "keyword.import"],
    settings: { foreground: "#D14D41" },
  },
  {
    scope: ["storage.modifier", "keyword.modifier", "storage.type"],
    settings: { foreground: "#4385BE" },
  },
  {
    scope: ["comment", "punctuation.definition.comment"],
    settings: { foreground: "#878580" },
  },
  {
    scope: ["comment.documentation", "comment.line.documentation"],
    settings: { foreground: "#575653" },
  },
  { scope: ["constant.numeric"], settings: { foreground: "#8B7EC8" } },
  {
    scope: ["constant.language.boolean", "constant.language.json"],
    settings: { foreground: "#D0A215" },
  },
  { scope: ["keyword.operator"], settings: { foreground: "#D14D41" } },
  {
    scope: ["entity.name.function.preprocessor"],
    settings: { foreground: "#4385BE" },
  },
  { scope: ["meta.preprocessor"], settings: { foreground: "#CE5D97" } },
  { scope: ["markup.underline.link"], settings: { foreground: "#4385BE" } },
  { scope: ["entity.name.tag"], settings: { foreground: "#4385BE" } },
  { scope: ["support.class.component"], settings: { foreground: "#CE5D97" } },
  {
    scope: ["entity.other.attribute-name", "meta.attribute"],
    settings: { foreground: "#D0A215" },
  },
  { scope: ["support.type"], settings: { foreground: "#D0A215" } },
  {
    scope: ["variable.other.constant", "variable.readonly"],
    settings: { foreground: "#CECDC3" },
  },
  {
    scope: ["entity.name.label", "punctuation.definition.label"],
    settings: { foreground: "#CE5D97" },
  },
  {
    scope: [
      "entity.name.namespace",
      "storage.modifier.namespace",
      "markup.bold.markdown",
    ],
    settings: { foreground: "#D0A215" },
  },
  {
    scope: ["entity.name.module", "storage.modifier.module"],
    settings: { foreground: "#D14D41" },
  },
  {
    scope: ["variable.type.parameter", "variable.parameter.type"],
    settings: { foreground: "#DA702C" },
  },
  {
    scope: ["keyword.control.exception", "keyword.control.trycatch"],
    settings: { foreground: "#CE5D97" },
  },
  {
    scope: [
      "meta.decorator",
      "punctuation.decorator",
      "entity.name.function.decorator",
    ],
    settings: { foreground: "#D0A215" },
  },
  { scope: ["variable.function"], settings: { foreground: "#CECDC3" } },
  {
    scope: [
      "punctuation",
      "punctuation.terminator",
      "punctuation.definition.tag",
      "punctuation.separator",
      "punctuation.definition.string",
      "punctuation.section.block",
    ],
    settings: { foreground: "#878580" },
  },
  {
    scope: ["punctuation.definition.heading.markdown"],
    settings: { foreground: "#CE5D97" },
  },
  {
    scope: [
      "storage.type.numeric.go",
      "storage.type.byte.go",
      "storage.type.boolean.go",
      "storage.type.string.go",
      "storage.type.uintptr.go",
      "storage.type.error.go",
      "storage.type.rune.go",
      "constant.language.go",
      "support.class.dart",
      "keyword.other.documentation",
      "storage.modifier.import.java",
      "punctuation.definition.list.begin.markdown",
      "punctuation.definition.quote.begin.markdown",
      "meta.separator.markdown",
      "entity.name.section.markdown",
    ],
    settings: { foreground: "#D0A215" },
  },
  {
    scope: [
      "markup.italic.markdown",
      "support.type.python",
      "variable.legacy.builtin.python",
      "support.constant.property-value.css",
      "storage.modifier.attribute.swift",
    ],
    settings: { foreground: "#3AA99F" },
  },
  {
    scope: ["keyword.channel.go", "keyword.other.platform.os.swift"],
    settings: { foreground: "#8B7EC8" },
  },
];

const FLEXOKI_LIGHT_TOKEN_COLORS = [
  {
    scope: ["source", "support.type.property-name.css"],
    settings: { foreground: "#100F0F" },
  },
  { scope: ["entity.name.type.class"], settings: { foreground: "#BC5215" } },
  {
    scope: ["entity.name.type.interface", "entity.name.type"],
    settings: { foreground: "#AD8301" },
  },
  { scope: ["entity.name.type.struct"], settings: { foreground: "#BC5215" } },
  { scope: ["entity.name.type.enum"], settings: { foreground: "#BC5215" } },
  {
    scope: ["meta.object-literal.key", "support.type.property-name"],
    settings: { foreground: "#BC5215" },
  },
  {
    scope: ["entity.name.function.method", "meta.function.method"],
    settings: { foreground: "#66800B" },
  },
  {
    scope: [
      "entity.name.function",
      "support.function",
      "meta.function-call.generic",
    ],
    settings: { foreground: "#BC5215", fontStyle: "bold" },
  },
  {
    scope: ["variable", "meta.variable", "variable.other.object.property"],
    settings: { foreground: "#100F0F" },
  },
  {
    scope: ["variable.other.object", "variable.other.readwrite.alias"],
    settings: { foreground: "#66800B" },
  },
  {
    scope: ["variable.other.global", "variable.language.this"],
    settings: { foreground: "#A02F6F" },
  },
  { scope: ["variable.other.local"], settings: { foreground: "#E6E4D9" } },
  {
    scope: ["variable.parameter", "meta.parameter"],
    settings: { foreground: "#100F0F" },
  },
  {
    scope: ["variable.other.property", "meta.property"],
    settings: { foreground: "#205EA6" },
  },
  {
    scope: ["string", "string.other.link", "markup.inline.raw.string.markdown"],
    settings: { foreground: "#24837B" },
  },
  {
    scope: ["constant.character.escape", "constant.other.placeholder"],
    settings: { foreground: "#100F0F" },
  },
  { scope: ["keyword"], settings: { foreground: "#66800B" } },
  {
    scope: ["keyword.control.import", "keyword.control.from", "keyword.import"],
    settings: { foreground: "#AF3029" },
  },
  {
    scope: ["storage.modifier", "keyword.modifier", "storage.type"],
    settings: { foreground: "#205EA6" },
  },
  {
    scope: ["comment", "punctuation.definition.comment"],
    settings: { foreground: "#6F6E69" },
  },
  {
    scope: ["comment.documentation", "comment.line.documentation"],
    settings: { foreground: "#B7B5AC" },
  },
  { scope: ["constant.numeric"], settings: { foreground: "#5E409D" } },
  {
    scope: ["constant.language.boolean", "constant.language.json"],
    settings: { foreground: "#AD8301" },
  },
  { scope: ["keyword.operator"], settings: { foreground: "#AF3029" } },
  {
    scope: ["entity.name.function.preprocessor"],
    settings: { foreground: "#205EA6" },
  },
  { scope: ["meta.preprocessor"], settings: { foreground: "#A02F6F" } },
  { scope: ["markup.underline.link"], settings: { foreground: "#205EA6" } },
  { scope: ["entity.name.tag"], settings: { foreground: "#205EA6" } },
  { scope: ["support.class.component"], settings: { foreground: "#A02F6F" } },
  {
    scope: ["entity.other.attribute-name", "meta.attribute"],
    settings: { foreground: "#AD8301" },
  },
  { scope: ["support.type"], settings: { foreground: "#AD8301" } },
  {
    scope: ["variable.other.constant", "variable.readonly"],
    settings: { foreground: "#100F0F" },
  },
  {
    scope: ["entity.name.label", "punctuation.definition.label"],
    settings: { foreground: "#A02F6F" },
  },
  {
    scope: [
      "entity.name.namespace",
      "storage.modifier.namespace",
      "markup.bold.markdown",
    ],
    settings: { foreground: "#AD8301" },
  },
  {
    scope: ["entity.name.module", "storage.modifier.module"],
    settings: { foreground: "#AF3029" },
  },
  {
    scope: ["variable.type.parameter", "variable.parameter.type"],
    settings: { foreground: "#BC5215" },
  },
  {
    scope: ["keyword.control.exception", "keyword.control.trycatch"],
    settings: { foreground: "#A02F6F" },
  },
  {
    scope: [
      "meta.decorator",
      "punctuation.decorator",
      "entity.name.function.decorator",
    ],
    settings: { foreground: "#AD8301" },
  },
  { scope: ["variable.function"], settings: { foreground: "#100F0F" } },
  {
    scope: [
      "punctuation",
      "punctuation.terminator",
      "punctuation.definition.tag",
      "punctuation.separator",
      "punctuation.definition.string",
      "punctuation.section.block",
    ],
    settings: { foreground: "#6F6E69" },
  },
  {
    scope: ["punctuation.definition.heading.markdown"],
    settings: { foreground: "#A02F6F" },
  },
  {
    scope: [
      "storage.type.numeric.go",
      "storage.type.byte.go",
      "storage.type.boolean.go",
      "storage.type.string.go",
      "storage.type.uintptr.go",
      "storage.type.error.go",
      "storage.type.rune.go",
      "constant.language.go",
      "support.class.dart",
      "keyword.other.documentation",
      "storage.modifier.import.java",
      "punctuation.definition.list.begin.markdown",
      "punctuation.definition.quote.begin.markdown",
      "meta.separator.markdown",
      "entity.name.section.markdown",
    ],
    settings: { foreground: "#AD8301" },
  },
  {
    scope: [
      "markup.italic.markdown",
      "support.type.python",
      "variable.legacy.builtin.python",
      "support.constant.property-value.css",
      "storage.modifier.attribute.swift",
    ],
    settings: { foreground: "#24837B" },
  },
  {
    scope: ["keyword.channel.go", "keyword.other.platform.os.swift"],
    settings: { foreground: "#5E409D" },
  },
];

registerCustomTheme("flexoki-dark", async () => ({
  name: "flexoki-dark",
  type: "dark",
  fg: "#CECDC3",
  bg: "#100F0F",
  settings: FLEXOKI_DARK_TOKEN_COLORS,
}));

registerCustomTheme("flexoki-light", async () => ({
  name: "flexoki-light",
  type: "light",
  fg: "#100F0F",
  bg: "#FFFCF0",
  settings: FLEXOKI_LIGHT_TOKEN_COLORS,
}));

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
      "status-trusted": "#2563eb",
      "status-rejected": "#e11d48",
      "status-pending": "#ea580c",
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
    id: "flexoki-dark",
    label: "Flexoki Dark",
    colorScheme: "dark",
    preview: ["#100F0F", "#CECDC3", "#DA702C"],
    codeTheme: "flexoki-dark",
    tokens: {
      surface: "#100F0F",
      "surface-inset": "#1C1B1A",
      "surface-panel": "#1C1B1A",
      "surface-raised": "#282726",
      "surface-overlay": "#343331",
      "surface-hover": "#343331",
      "surface-active": "#403E3C",
      fg: "#FFFCF0",
      "fg-secondary": "#CECDC3",
      "fg-muted": "#878580",
      "fg-faint": "#575653",
      edge: "rgba(206, 205, 195, 0.12)",
      "edge-default": "rgba(206, 205, 195, 0.2)",
      "edge-strong": "rgba(206, 205, 195, 0.35)",
      "focus-ring": "#DA702C",
      selection: "rgba(67, 133, 190, 0.3)",
      link: "#4385BE",
      "status-approved": "#879A39",
      "status-trusted": "#4385BE",
      "status-rejected": "#D14D41",
      "status-pending": "#DA702C",
      "status-saved": "#D0A215",
      guide: "#8B7EC8",
      "status-added": "#879A39",
      "status-modified": "#D0A215",
      "status-deleted": "#D14D41",
      "status-renamed": "#4385BE",
      "status-untracked": "#879A39",
      "status-moved": "#4385BE",
      "status-warning": "#D0A215",
      "status-info": "#4385BE",
      "diff-added": "#879A39",
      "diff-removed": "#D14D41",
    },
  },
  {
    id: "flexoki-light",
    label: "Flexoki Light",
    colorScheme: "light",
    preview: ["#FFFCF0", "#100F0F", "#BC5215"],
    codeTheme: "flexoki-light",
    tokens: {
      surface: "#FFFCF0",
      "surface-inset": "#F2F0E5",
      "surface-panel": "#F2F0E5",
      "surface-raised": "#E6E4D9",
      "surface-overlay": "#FFFCF0",
      "surface-hover": "#DAD8CE",
      "surface-active": "#CECDC3",
      fg: "#100F0F",
      "fg-secondary": "#1C1B1A",
      "fg-muted": "#6F6E69",
      "fg-faint": "#9F9D96",
      edge: "rgba(28, 27, 26, 0.12)",
      "edge-default": "rgba(28, 27, 26, 0.2)",
      "edge-strong": "rgba(28, 27, 26, 0.35)",
      "focus-ring": "#BC5215",
      selection: "rgba(32, 94, 166, 0.2)",
      link: "#205EA6",
      "status-approved": "#66800B",
      "status-trusted": "#205EA6",
      "status-rejected": "#AF3029",
      "status-pending": "#BC5215",
      "status-saved": "#AD8301",
      guide: "#5E409D",
      "status-added": "#66800B",
      "status-modified": "#AD8301",
      "status-deleted": "#AF3029",
      "status-renamed": "#205EA6",
      "status-untracked": "#66800B",
      "status-moved": "#205EA6",
      "status-warning": "#AD8301",
      "status-info": "#205EA6",
      "diff-added": "#66800B",
      "diff-removed": "#AF3029",
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
      "status-trusted": "#268bd2",
      "status-rejected": "#dc322f",
      "status-pending": "#cb4b16",
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
