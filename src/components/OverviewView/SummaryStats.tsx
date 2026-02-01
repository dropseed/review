function StatChip({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="text-xxs text-stone-500">{label}</span>
      <span className="text-xxs text-stone-400 font-medium tabular-nums">
        {count}
      </span>
    </div>
  );
}

export function SummaryStats({
  totalHunks,
  trustedHunks,
  approvedHunks,
  pendingHunks,
  reviewedPercent,
}: {
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  pendingHunks: number;
  reviewedPercent: number;
}) {
  if (totalHunks === 0) {
    return (
      <div className="px-4 pb-8 mb-4 border-b border-stone-800">
        <div className="flex flex-col items-center py-8">
          {/* Abstract diff lines — empty */}
          <div className="mb-5 w-40 space-y-1.5 opacity-30">
            <div className="flex gap-2 items-center">
              <span className="w-4 text-right font-mono text-xxs text-stone-600">
                1
              </span>
              <div className="h-px flex-1 bg-stone-700" />
            </div>
            <div className="flex gap-2 items-center">
              <span className="w-4 text-right font-mono text-xxs text-stone-600">
                2
              </span>
              <div className="h-px flex-1 bg-stone-700" />
            </div>
            <div className="flex gap-2 items-center">
              <span className="w-4 text-right font-mono text-xxs text-stone-600">
                3
              </span>
              <div className="h-px flex-1 bg-stone-700" />
            </div>
          </div>
          <p className="text-sm font-medium text-stone-400 mb-1">
            No changes to review
          </p>
          <p className="text-xs text-stone-600 text-center max-w-[220px]">
            The base and compare refs are identical, or no diff hunks were
            found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 mb-4">
      <div className="flex items-center gap-3">
        {/* Compact progress bar */}
        <div className="h-1.5 flex-1 rounded-full bg-stone-800 overflow-hidden flex">
          {trustedHunks > 0 && (
            <div
              className="bg-cyan-500 transition-all duration-300"
              style={{ width: `${(trustedHunks / totalHunks) * 100}%` }}
            />
          )}
          {approvedHunks > 0 && (
            <div
              className="bg-lime-500 transition-all duration-300"
              style={{ width: `${(approvedHunks / totalHunks) * 100}%` }}
            />
          )}
        </div>

        <span className="text-xs font-medium text-stone-300 tabular-nums whitespace-nowrap">
          {reviewedPercent}%
        </span>
      </div>

      {/* Stat chips */}
      <div className="flex items-center gap-4 mt-2">
        <StatChip color="bg-cyan-500" label="Trusted" count={trustedHunks} />
        <StatChip color="bg-lime-500" label="Approved" count={approvedHunks} />
        <StatChip color="bg-amber-500" label="Pending" count={pendingHunks} />
        <span className="text-xxs text-stone-600 tabular-nums ml-auto">
          {trustedHunks + approvedHunks}/{totalHunks} hunks
        </span>
      </div>
    </div>
  );
}
