import { type ReactNode, useState } from "react";
import {
  useChangeComposition,
  type CategorySegment,
} from "../../hooks/useChangeComposition";

const CATEGORY_COLORS: Record<string, string> = {
  imports: "bg-status-trusted",
  formatting: "bg-surface-active",
  comments: "bg-status-modified",
  types: "bg-status-classifying",
  file: "bg-pink-500",
  hunk: "bg-orange-500",
  generated: "bg-status-approved",
  rename: "bg-blue-500",
};

function BarSegment({
  segment,
  total,
  isHovered,
  isDimmed,
  onHover,
  onLeave,
}: {
  segment: CategorySegment;
  total: number;
  isHovered: boolean;
  isDimmed: boolean;
  onHover: () => void;
  onLeave: () => void;
}): ReactNode {
  if (segment.count === 0) return null;
  const colorClass = CATEGORY_COLORS[segment.categoryId] || "bg-surface-active";
  return (
    <div
      className={`${colorClass} transition-opacity duration-150 ${isDimmed ? "opacity-25" : isHovered ? "opacity-100" : "opacity-80"}`}
      style={{ width: `${(segment.count / total) * 100}%` }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    />
  );
}

function LegendItem({
  segment,
  isHovered,
  isDimmed,
  onHover,
  onLeave,
}: {
  segment: CategorySegment;
  isHovered: boolean;
  isDimmed: boolean;
  onHover: () => void;
  onLeave: () => void;
}): ReactNode {
  const dotColor = CATEGORY_COLORS[segment.categoryId] || "bg-surface-active";
  return (
    <span
      className={`flex items-center gap-1.5 transition-opacity duration-150 cursor-default ${isDimmed ? "opacity-30" : isHovered ? "opacity-100" : ""}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
      <span className="text-fg-muted">{segment.categoryName}</span>
      <span className="text-fg0 tabular-nums">{segment.count}</span>
    </span>
  );
}

export function ChangeComposition(): ReactNode {
  const composition = useChangeComposition();
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  if (composition.totalClassified === 0) return null;

  return (
    <div className="rounded-lg border border-edge p-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-medium text-fg-muted">
          Change Composition
        </span>
        <span className="text-xxs tabular-nums text-fg0">
          {composition.totalClassified} classified
          {composition.totalUnclassified > 0 && (
            <> &middot; {composition.totalUnclassified} pending</>
          )}
        </span>
      </div>

      <div className="h-2.5 rounded-full bg-surface-raised overflow-hidden flex">
        {composition.segments.map((segment) => (
          <BarSegment
            key={segment.categoryId}
            segment={segment}
            total={composition.totalClassified}
            isHovered={hoveredCategory === segment.categoryId}
            isDimmed={
              hoveredCategory !== null && hoveredCategory !== segment.categoryId
            }
            onHover={() => setHoveredCategory(segment.categoryId)}
            onLeave={() => setHoveredCategory(null)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xxs">
        {composition.segments.map((segment) => (
          <LegendItem
            key={segment.categoryId}
            segment={segment}
            isHovered={hoveredCategory === segment.categoryId}
            isDimmed={
              hoveredCategory !== null && hoveredCategory !== segment.categoryId
            }
            onHover={() => setHoveredCategory(segment.categoryId)}
            onLeave={() => setHoveredCategory(null)}
          />
        ))}
      </div>
    </div>
  );
}
