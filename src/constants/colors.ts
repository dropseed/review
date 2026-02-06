/**
 * Semantic color system for the Review app.
 *
 * Color assignments:
 * - Trust (auto-approve patterns): cyan
 * - Approve (manual): lime
 * - Reject: rose
 * - Classifying (AI): violet
 * - Focus/UI accent: amber
 *
 * Git file status:
 * - Added: lime, Modified: amber, Deleted: rose, Renamed: sky
 */

export const SEMANTIC_COLORS = {
  trust: "cyan",
  approve: "lime",
  reject: "rose",
  classifying: "violet",
  focus: "amber",
} as const;

export type SemanticColor =
  (typeof SEMANTIC_COLORS)[keyof typeof SEMANTIC_COLORS];

// Tailwind class helpers for consistent color usage
export const TRUST_CLASSES = {
  text: "text-cyan-400",
  textMuted: "text-cyan-300",
  textSubtle: "text-cyan-400/70",
  bg: "bg-cyan-500",
  bgSubtle: "bg-cyan-500/10",
  bgHover: "hover:bg-cyan-500/20",
  border: "border-cyan-500",
  borderSubtle: "border-cyan-500/20",
  borderHover: "hover:border-cyan-500/50",
  ring: "ring-cyan-500/30",
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
