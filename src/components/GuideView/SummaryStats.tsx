import type { ReviewProgress } from "../../hooks/useReviewProgress";

interface StatChipProps {
  color: string;
  label: string;
  count: number;
}

function StatChip({ color, label, count }: StatChipProps) {
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

interface ProgressSegmentProps {
  count: number;
  total: number;
  className: string;
}

function ProgressSegment({ count, total, className }: ProgressSegmentProps) {
  if (count === 0) return null;
  return (
    <div
      className={`${className} transition-all duration-300`}
      style={{ width: `${(count / total) * 100}%` }}
    />
  );
}

const STATE_BADGE_CONFIG: Record<
  string,
  { label: string; colorClass: string }
> = {
  approved: {
    label: "Approved",
    colorClass: "text-emerald-300 bg-emerald-500/10",
  },
  changes_requested: {
    label: "Changes Requested",
    colorClass: "text-rose-300 bg-rose-500/10",
  },
};

function StateBadge({ state }: { state: ReviewProgress["state"] }) {
  if (!state) return null;
  const config = STATE_BADGE_CONFIG[state];
  if (!config) return null;
  return (
    <span
      className={`text-xxs font-medium px-1.5 py-0.5 rounded ${config.colorClass}`}
    >
      {config.label}
    </span>
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
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-stone-800 overflow-hidden flex">
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

        <span className="text-xs font-medium text-stone-300 tabular-nums whitespace-nowrap">
          {reviewedPercent}%
        </span>

        <StateBadge state={state} />
      </div>

      <div className="flex items-center gap-4 mt-2">
        <StatChip color="bg-cyan-500" label="Trusted" count={trustedHunks} />
        <StatChip
          color="bg-emerald-500"
          label="Approved"
          count={approvedHunks}
        />
        {rejectedHunks > 0 && (
          <StatChip
            color="bg-rose-500"
            label="Rejected"
            count={rejectedHunks}
          />
        )}
        <StatChip color="bg-amber-500" label="Pending" count={pendingHunks} />
        <span className="text-xxs text-stone-600 tabular-nums ml-auto">
          {reviewedHunks}/{totalHunks} hunks
        </span>
      </div>
    </div>
  );
}
