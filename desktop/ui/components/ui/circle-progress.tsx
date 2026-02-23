import type React from "react";

interface CircleProgressSegment {
  percent: number;
  color: string;
}

interface CircleProgressProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  ref?: React.Ref<SVGSVGElement>;
  /** Optional stacked segments (drawn in order). When provided, these replace the single-color arc. */
  segments?: CircleProgressSegment[];
}

/** SVG circular progress indicator using brand colors. */
export function CircleProgress({
  percent,
  size = 14,
  strokeWidth = 2,
  className,
  ref,
  segments,
}: CircleProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const isComplete = percent >= 100;

  // Build arcs: either from explicit segments or a single arc from percent
  let arcs: { offset: number; length: number; color: string }[] = [];
  if (segments && segments.length > 0) {
    let consumed = 0;
    for (const seg of segments) {
      if (seg.percent <= 0) continue;
      const length = (seg.percent / 100) * circumference;
      arcs.push({
        offset: circumference - consumed - length,
        length,
        color: seg.color,
      });
      consumed += length;
    }
  } else if (percent > 0) {
    const offset = circumference - (percent / 100) * circumference;
    arcs = [
      {
        offset,
        length: circumference - offset,
        color: isComplete
          ? "var(--color-status-modified)"
          : "var(--color-status-approved)",
      },
    ];
  }

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      className={className ?? "shrink-0"}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${percent}% reviewed`}
    >
      {/* Track ring */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="color-mix(in srgb, var(--color-fg) 8%, transparent)"
        strokeWidth={strokeWidth}
      />
      {/* Filled arc(s) */}
      {arcs.map((arc, i) => (
        <circle
          key={i}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={arc.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={arc.offset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-[stroke-dashoffset] duration-300"
        />
      ))}
    </svg>
  );
}
