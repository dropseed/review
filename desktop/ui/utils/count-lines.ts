/** Count newlines in a string without allocating split arrays. */
export function countLines(s: string | undefined | null): number {
  if (!s) return 0;
  let count = 1;
  let idx = -1;
  while ((idx = s.indexOf("\n", idx + 1)) !== -1) count++;
  return count;
}
