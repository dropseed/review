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
        <span className="text-lg font-bold tabular-nums tracking-tight text-fg shrink-0">
          {reviewedPercent}
          <span className="text-xs font-medium text-fg0 ml-px">%</span>
        </span>

        <div className="h-2 flex-1 rounded-full bg-surface-raised overflow-hidden flex">
          <ProgressSegment
            count={trustedHunks}
            total={totalHunks}
            className="bg-status-trusted"
          />
          <ProgressSegment
            count={approvedHunks}
            total={totalHunks}
            className="bg-status-approved"
          />
          <ProgressSegment
            count={rejectedHunks}
            total={totalHunks}
            className="bg-status-rejected"
          />
        </div>

        {state === "approved" && (
          <span className="text-xxs font-medium px-2 py-0.5 rounded-full bg-status-approved/10 text-status-approved shrink-0">
            Approved
          </span>
        )}
        {state === "changes_requested" && (
          <span className="text-xxs font-medium px-2 py-0.5 rounded-full bg-status-rejected/10 text-status-rejected shrink-0">
            Changes Requested
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-1.5 text-xxs tabular-nums">
        <span className="text-status-trusted/70">{trustedHunks} trusted</span>
        <span className="text-fg-faint">&middot;</span>
        <span className="text-status-approved/70">
          {approvedHunks} approved
        </span>
        {rejectedHunks > 0 && (
          <>
            <span className="text-fg-faint">&middot;</span>
            <span className="text-status-rejected/70">
              {rejectedHunks} rejected
            </span>
          </>
        )}
        <span className="text-fg-faint">&middot;</span>
        <span className="text-fg0">{pendingHunks} pending</span>
        <span className="text-fg-faint ml-auto">
          {reviewedHunks}/{totalHunks} hunks
        </span>
      </div>
    </div>
  );
}
