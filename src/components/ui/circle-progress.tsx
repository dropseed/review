/** SVG circular progress indicator using brand colors. */
export function CircleProgress({
  percent,
  size = 14,
  strokeWidth = 2,
  className,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const center = size / 2;
  const isComplete = percent >= 100;

  return (
    <svg
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
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeWidth}
      />
      {/* Filled arc -- sage green in progress, amber when complete */}
      {percent > 0 && (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={
            isComplete ? "var(--color-amber-500)" : "var(--color-sage-400)"
          }
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-all duration-300"
        />
      )}
    </svg>
  );
}
