interface GitStatusCountsProps {
  staged: number;
  unstaged: number;
  untracked: number;
}

export function GitStatusCounts({
  staged,
  unstaged,
  untracked,
}: GitStatusCountsProps) {
  return (
    <>
      {staged > 0 && (
        <span className="font-mono text-xxs font-medium tabular-nums text-emerald-400">
          +{staged}
        </span>
      )}
      {unstaged > 0 && (
        <span className="font-mono text-xxs font-medium tabular-nums text-amber-400">
          ~{unstaged}
        </span>
      )}
      {untracked > 0 && (
        <span className="font-mono text-xxs font-medium tabular-nums text-stone-500">
          ?{untracked}
        </span>
      )}
    </>
  );
}
