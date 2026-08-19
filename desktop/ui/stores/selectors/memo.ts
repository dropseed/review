/**
 * Identity-keyed memo for store selectors.
 *
 * Zustand calls a selector once per subscriber per state change, so a selector
 * that flattens, walks or Map-builds does that work N times for N subscribers —
 * and returns a fresh array each time, which then fails every downstream
 * `===` check. Caching on input identity collapses that to one build per
 * actual state change, shared by every caller.
 *
 * The pattern was written out eleven times across `selectors/` before this,
 * each with its own hand-rolled comparison; `sidebar.ts` had already
 * generalised it to a positional deps list, which is what this is.
 *
 * Correctness rests on one thing: every input the builder reads must appear in
 * `deps`, because identity is the whole test. Anything the builder reads from
 * outside its arguments — a clock, `Math.random`, a module-level mutable — is
 * not something this can see, so builders must be pure functions of `deps`.
 */
export function memoOnIdentity<T>(): (
  deps: readonly unknown[],
  build: () => T,
) => T {
  let cached: { deps: readonly unknown[]; output: T } | null = null;

  return (deps, build) => {
    if (
      cached &&
      cached.deps.length === deps.length &&
      cached.deps.every((dep, i) => dep === deps[i])
    ) {
      return cached.output;
    }
    const output = build();
    cached = { deps, output };
    return output;
  };
}
