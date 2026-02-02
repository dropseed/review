/**
 * PR number badge with GitHub-matching state colors.
 *
 * Colors follow GitHub's Primer design system:
 * - Open  → green
 * - Draft → gray
 * - Merged → purple
 * - Closed → red
 */

const stateStyles = {
  open: "text-green-400 bg-green-500/10 border-green-500/20",
  draft: "text-stone-400 bg-stone-500/10 border-stone-500/20",
  merged: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  closed: "text-red-400 bg-red-500/10 border-red-500/20",
  muted: "text-stone-500 bg-stone-800/30 border-stone-700/20",
} as const;

export type PrState = keyof typeof stateStyles;

/** Derive a visual state from GitHub's API fields. */
export function getPrState(ghState: string, isDraft: boolean): PrState {
  if (ghState === "MERGED") return "merged";
  if (ghState === "CLOSED") return "closed";
  if (isDraft) return "draft";
  return "open";
}

/** Map a visual PR state to hover/focus accent classes. */
export function getPrAccentClasses(state: PrState): {
  hover: string;
  focus: string;
} {
  switch (state) {
    case "merged":
      return {
        hover:
          "hover:border-purple-500/25 hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl hover:shadow-purple-900/10",
        focus: "focus:inset-ring-purple-500/50",
      };
    case "closed":
      return {
        hover:
          "hover:border-red-500/25 hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl hover:shadow-red-900/10",
        focus: "focus:inset-ring-red-500/50",
      };
    case "draft":
      return {
        hover:
          "hover:border-stone-500/25 hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl hover:shadow-stone-900/10",
        focus: "focus:inset-ring-stone-500/50",
      };
    default:
      return {
        hover:
          "hover:border-green-500/25 hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl hover:shadow-green-900/10",
        focus: "focus:inset-ring-green-500/50",
      };
  }
}

interface PrBadgeProps {
  number: number;
  state?: PrState;
}

export function PrBadge({ number, state = "open" }: PrBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 font-mono text-xs px-2 py-0.5 rounded-md border ${stateStyles[state]}`}
    >
      <svg
        className="w-3 h-3"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
      #{number}
    </span>
  );
}
