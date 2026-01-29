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
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-stone-400">{label}</span>
      <span className="text-xs text-stone-300 font-medium tabular-nums">
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
    <div className="px-4 pb-4 mb-4 border-b border-stone-800">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl font-semibold text-stone-100 tabular-nums">
          {reviewedPercent}%
        </span>
        <span className="text-sm text-stone-400">reviewed</span>
        <span className="text-xs text-stone-600 tabular-nums ml-auto">
          {trustedHunks + approvedHunks}/{totalHunks} hunks
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-stone-800 overflow-hidden flex">
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

      {/* Stat chips */}
      <div className="flex items-center gap-4 mt-3">
        <StatChip color="bg-cyan-500" label="Trusted" count={trustedHunks} />
        <StatChip color="bg-lime-500" label="Approved" count={approvedHunks} />
        <StatChip
          color="bg-amber-500"
          label="Needs Review"
          count={pendingHunks}
        />
        <span className="text-xxs text-stone-600 tabular-nums ml-auto">
          {totalHunks} total
        </span>
      </div>
    </div>
  );
}
