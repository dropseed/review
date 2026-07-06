/** A "42" or "42-48" line reference; "" when start is undefined. Never "42-42". */
export function lineRangeRef(start: number | undefined, end?: number): string {
  if (start === undefined) return "";
  return end && end !== start ? `${start}-${end}` : `${start}`;
}
