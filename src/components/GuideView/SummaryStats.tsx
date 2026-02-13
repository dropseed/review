import type { ReviewProgress } from "../../hooks/useReviewProgress";

function ProgressSegment({
  count,
  total,
  className,
}: {
  count: number;
  total: number;
  className: string;
}) {
  if (count === 0) return null;
  return (
    <div
      className={`${className} transition-[width] duration-500 ease-out`}
      style={{ width: `${(count / total) * 100}%` }}
    />
  );
}

export function SummaryStats({
  totalHunks,
  trustedHunks,
  approvedHunks,
  rejectedHunks,
  reviewedHunks,
  pendingHunks,
  reviewedPercent,
  state,
}: ReviewProgress) {
  return (
    <div className="px-4 pt-3 pb-1.5">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold tabular-nums tracking-tight text-stone-100 shrink-0">
          {reviewedPercent}
          <span className="text-xs font-medium text-stone-500 ml-px">%</span>
        </span>

        <div className="h-2 flex-1 rounded-full bg-stone-800 overflow-hidden flex">
          <ProgressSegment
            count={trustedHunks}
            total={totalHunks}
            className="bg-cyan-500"
          />
          <ProgressSegment
            count={approvedHunks}
            total={totalHunks}
            className="bg-emerald-500"
          />
          <ProgressSegment
            count={rejectedHunks}
            total={totalHunks}
            className="bg-rose-500"
          />
        </div>

        {state === "approved" && (
          <span className="text-xxs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 shrink-0">
            Approved
          </span>
        )}
        {state === "changes_requested" && (
          <span className="text-xxs font-medium px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 shrink-0">
            Changes Requested
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-1.5 text-xxs tabular-nums">
        <span className="text-cyan-400/70">{trustedHunks} trusted</span>
        <span className="text-stone-700">&middot;</span>
        <span className="text-emerald-400/70">{approvedHunks} approved</span>
        {rejectedHunks > 0 && (
          <>
            <span className="text-stone-700">&middot;</span>
            <span className="text-rose-400/70">{rejectedHunks} rejected</span>
          </>
        )}
        <span className="text-stone-700">&middot;</span>
        <span className="text-stone-500">{pendingHunks} pending</span>
        <span className="text-stone-600 ml-auto">
          {reviewedHunks}/{totalHunks} hunks
        </span>
      </div>
    </div>
  );
}
