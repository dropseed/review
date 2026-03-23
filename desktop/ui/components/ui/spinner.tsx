/** Shared loading spinner. Size and colors are customized via className. */
export function Spinner({
  className = "h-4 w-4 border-2 border-edge-default border-t-status-modified",
}: {
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
