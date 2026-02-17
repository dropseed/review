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
        <span className="font-mono text-xxs font-medium tabular-nums text-status-approved">
          +{staged}
        </span>
      )}
      {unstaged > 0 && (
        <span className="font-mono text-xxs font-medium tabular-nums text-status-modified">
          ~{unstaged}
        </span>
      )}
      {untracked > 0 && (
        <span className="font-mono text-xxs font-medium tabular-nums text-fg0">
          ?{untracked}
        </span>
      )}
    </>
  );
}
