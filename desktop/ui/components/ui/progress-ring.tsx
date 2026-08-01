import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * A percentage as a ring: a track, and an arc over it starting at twelve
 * o'clock.
 *
 * Decorative by contract — the svg is `aria-hidden`, so the caller owes a
 * label on whatever control the ring sits inside. `CircleProgress` is the
 * other half of that split: a standalone `progressbar` that names itself.
 *
 * `size` is the viewBox extent and the geometry it implies; the rendered size
 * comes from `className`, in rem, so the ring tracks the UI scale the way the
 * rest of the chrome does.
 */
export function ProgressRing({
  percent,
  size,
  strokeWidth,
  radius = (size - strokeWidth * 2) / 2,
  className,
  arcClassName,
}: {
  percent: number;
  size: number;
  strokeWidth: number;
  /** Defaults to the widest ring whose stroke still clears the box. */
  radius?: number;
  className?: string;
  /** Stroke class for the filled arc — the one part callers vary. */
  arcClassName: string;
}): ReactNode {
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("-rotate-90", className)}
      fill="none"
      strokeWidth={strokeWidth}
      aria-hidden="true"
    >
      <circle cx={center} cy={center} r={radius} className="stroke-fg/15" />
      <circle
        cx={center}
        cy={center}
        r={radius}
        strokeLinecap="round"
        strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
        className={arcClassName}
      />
    </svg>
  );
}
