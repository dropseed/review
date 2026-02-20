/**
 * Semantic color system for the Review app.
 *
 * All colors reference the semantic design tokens defined in index.css.
 * These tokens are runtime-overridable for VS Code theme integration.
 *
 * Status token mapping:
 * - Trust (auto-approve patterns): status-trusted
 * - Approve (manual): status-approved
 * - Reject: status-rejected
 * - Guide: guide
 * - Focus/UI accent: focus-ring
 *
 * Git file status:
 * - Added: status-added, Modified: status-modified, Deleted: status-deleted, Renamed: status-renamed
 */

export const SEMANTIC_COLORS = {
  trust: "status-trusted",
  approve: "status-approved",
  reject: "status-rejected",
  guide: "guide",
  focus: "focus-ring",
} as const;

export type SemanticColor =
  (typeof SEMANTIC_COLORS)[keyof typeof SEMANTIC_COLORS];

// Tailwind class helpers for consistent color usage
export const TRUST_CLASSES = {
  text: "text-status-trusted",
  textMuted: "text-status-trusted/80",
  textSubtle: "text-status-trusted/70",
  bg: "bg-status-trusted",
  bgSubtle: "bg-status-trusted/10",
  bgHover: "hover:bg-status-trusted/20",
  border: "border-status-trusted",
  borderSubtle: "border-status-trusted/20",
  borderHover: "hover:border-status-trusted/50",
  ring: "ring-status-trusted/30",
  shadow: "shadow-[0_0_8px_rgba(6,182,212,0.3)]",
} as const;

// Brand colors from logo - terracotta for base/old, sage for compare/new
export const TERRACOTTA_CLASSES = {
  text: "text-terracotta-400",
  textMuted: "text-terracotta-500",
  bg: "bg-terracotta-500",
  bgSubtle: "bg-terracotta-500/10",
  bgHover: "hover:bg-terracotta-500/20",
  border: "border-terracotta-500",
  borderSubtle: "border-terracotta-500/20",
  ring: "ring-terracotta-500/30",
} as const;

export const SAGE_CLASSES = {
  text: "text-sage-400",
  textMuted: "text-sage-500",
  bg: "bg-sage-500",
  bgSubtle: "bg-sage-500/10",
  bgHover: "hover:bg-sage-500/20",
  border: "border-sage-500",
  borderSubtle: "border-sage-500/20",
  ring: "ring-sage-500/30",
} as const;
