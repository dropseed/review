/**
 * Fast djb2 string hash. Returns an unsigned 32-bit integer.
 * Used to generate cache keys for @pierre/diffs FileContents objects.
 */
export function stringHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
