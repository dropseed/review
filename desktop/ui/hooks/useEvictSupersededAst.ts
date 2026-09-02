import { useEffect, useRef } from "react";
import { useWorkerPool } from "@pierre/diffs/react";

/**
 * The cache keys a surface is currently rendering, one per named slot.
 *
 * Slots are named rather than listed because "this slot holds a different key
 * now" and "this slot is unused at the moment" have to mean different things —
 * see `useEvictSupersededAst`. A slot's value is `undefined` while the surface
 * isn't rendering anything in it.
 */
export type AstSlots = Readonly<Record<string, string | undefined>>;

/**
 * The diff cache key pierre derives for a pair of file contents.
 *
 * `parseDiffFromFile` joins the two file keys with a colon and the pool caches
 * the rendered diff under the result, so this is how a surface that hands
 * `MultiFileDiff` two files names the diff AST it is holding. (The two file
 * keys themselves are not cached under — only a `"file"` request populates the
 * file cache, and rendering a diff never makes one.)
 */
export function diffCacheKey(
  oldKey: string | undefined,
  newKey: string | undefined,
): string | undefined {
  if (oldKey == null || newKey == null) return undefined;
  return `${oldKey}:${newKey}`;
}

/**
 * A by-value identity for a slot record.
 *
 * The separators are control characters because they have to be ones a cache
 * key cannot contain — keys are built from file paths, which may hold spaces
 * and colons — or a shift in where one slot ends and the next begins could
 * produce the same string and the effect would not run.
 */
function fingerprintOf(slots: AstSlots): string {
  return Object.keys(slots)
    .sort()
    .map((slot) => `${slot}\u0000${slots[slot] ?? ""}`)
    .join("\u0001");
}

/**
 * Evict the key each slot replaced, and only that.
 *
 * `held` is mutated: a slot that has gone empty keeps the key it last held, so
 * a surface that comes back to it can still recognize a supersession across the
 * gap.
 */
function evictSuperseded(
  next: AstSlots,
  held: Record<string, string>,
  evict: (key: string) => void,
): void {
  for (const slot of Object.keys(next)) {
    const key = next[slot];
    // An empty slot is not a supersession. The surface has switched modes, and
    // what it was showing is exactly what it will want back.
    if (key == null) continue;
    const previous = held[slot];
    if (previous != null && previous !== key) evict(previous);
    held[slot] = key;
  }
}

/**
 * Evict the ASTs this surface has just stopped asking for.
 *
 * Every cache key the diff surfaces mint embeds a hash of the content it
 * describes (`file:<path>:<hash>`), so editing a file does not update its entry
 * in the pool's cache — it mints a new key and orphans the old one. Both LRUs
 * are sized in *entries* rather than bytes, and an entry is a whole file's
 * tokenized AST, so nothing about being full is self-correcting: a review that
 * is edited while it is open — a watcher-driven reload while an agent writes
 * files, which is the ordinary way Spur gets used — spends the cache on dead
 * versions of the few files being edited and evicts the ones still on screen to
 * make room for them. The cache ends up holding the only copies nobody will ask
 * for again, and every scroll re-highlights from scratch.
 *
 * The orphan is knowable exactly where it is made: the surface that asked for
 * the old hash is the one now asking for a new one, and nothing will ask for
 * the old hash again. So each surface names its slots here and the key each one
 * replaced is dropped.
 *
 * Two things are deliberately *not* evictions, because both describe an AST the
 * surface still wants:
 *
 *   - Unmounting. The Virtualizer unmounts whatever scrolls off screen, and
 *     still having that file's AST when it scrolls back is the point.
 *   - A slot going empty. Toggling to old/new view, or into outline mode, stops
 *     asking for the diff without superseding it — the toggle back wants the
 *     same AST, and evicting it makes every toolbar click cost a re-highlight.
 */
export function useEvictSupersededAst(files: AstSlots, diffs: AstSlots): void {
  const pool = useWorkerPool();
  const held = useRef<{
    files: Record<string, string>;
    diffs: Record<string, string>;
  }>({ files: {}, diffs: {} });

  // The callers rebuild these objects on every render, so the effect depends on
  // the slots by value — only a key that actually changed is an eviction.
  const filesFingerprint = fingerprintOf(files);
  const diffsFingerprint = fingerprintOf(diffs);

  useEffect(() => {
    // Without a pool nothing has been highlighted, so there is nothing cached
    // to evict — recording the keys is still right, and is what lets the first
    // supersession after the pool arrives be recognized.
    const noop = (): void => {};
    evictSuperseded(
      files,
      held.current.files,
      pool ? (key) => pool.evictFileFromCache(key) : noop,
    );
    evictSuperseded(
      diffs,
      held.current.diffs,
      pool ? (key) => pool.evictDiffFromCache(key) : noop,
    );
    // The fingerprints are the by-value identity of `files` and `diffs`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, filesFingerprint, diffsFingerprint]);
}
