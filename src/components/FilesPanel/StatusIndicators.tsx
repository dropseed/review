import type { FileHunkStatus } from "./types";

// Git status configuration
export const STATUS_CONFIG: Record<string, { letter: string; color: string }> =
  {
    added: { letter: "A", color: "text-lime-400" },
    modified: { letter: "M", color: "text-amber-400" },
    deleted: { letter: "D", color: "text-rose-400" },
    renamed: { letter: "R", color: "text-sky-400" },
    untracked: { letter: "U", color: "text-emerald-400" },
  };

// Status indicator dots
export function HunkStatusDots({ status }: { status: FileHunkStatus }) {
  if (status.total === 0) return null;

  // For many hunks, show counts instead of dots
  if (status.total > 5) {
    const reviewed = status.approved + status.trusted + status.rejected;
    const isComplete = status.pending === 0;
    return (
      <span
        className={`font-mono text-xxs tabular-nums ${isComplete ? "text-lime-500" : "text-stone-500"}`}
      >
        {reviewed}/{status.total}
      </span>
    );
  }

  // Show individual dots for small counts
  const dots: React.ReactNode[] = [];
  for (let i = 0; i < status.rejected; i++) {
    dots.push(
      <span key={`r${i}`} className="h-1.5 w-1.5 rounded-full bg-rose-500" />,
    );
  }
  for (let i = 0; i < status.pending; i++) {
    dots.push(
      <span key={`p${i}`} className="h-1.5 w-1.5 rounded-full bg-stone-600" />,
    );
  }
  for (let i = 0; i < status.approved; i++) {
    dots.push(
      <span key={`a${i}`} className="h-1.5 w-1.5 rounded-full bg-lime-500" />,
    );
  }
  for (let i = 0; i < status.trusted; i++) {
    dots.push(
      <span key={`t${i}`} className="h-1.5 w-1.5 rounded-full bg-amber-500" />,
    );
  }

  return <div className="flex items-center gap-0.5">{dots}</div>;
}

// Status letter indicator
export function StatusLetter({ status }: { status?: string }) {
  const config = status ? STATUS_CONFIG[status] : null;

  if (!config) {
    // Unchanged file - show dim dash
    return (
      <span className="w-3 text-center font-mono text-xxs text-stone-500">
        ·
      </span>
    );
  }

  return (
    <span
      className={`w-3 text-center font-mono text-xxs font-medium ${config.color}`}
    >
      {config.letter}
    </span>
  );
}
