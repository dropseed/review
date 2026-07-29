/**
 * Fuzzy matching and ranking, shared by every search surface in the app.
 *
 * The scores this produces are **normalized to 0..1**, which is the property
 * that makes the rest possible: a candidate can be scored across several
 * weighted fields (a command's title vs. its aliases, a file's name vs. its
 * path) and blended with an extrinsic signal (recency, "this file changed")
 * without one term quietly swamping the others.
 *
 * The matcher is a Smith-Waterman-style dynamic program over (query char,
 * text char) rather than a recursive path search. Same answers as an
 * exhaustive search, O(query x text) instead of exponential, and no heuristic
 * cutoffs that silently return a worse match than the one that exists.
 */

/** Characters that make the following character a "word start". */
const SEPARATOR = /[/\\._\-\s:]/;

// Per-character awards. These are relative weights, not points — the raw sum
// is normalized against the best achievable score for the same query length,
// so their absolute magnitude never leaks into the final number.
const BASE = 1;
const CONSECUTIVE = 1.2;
/** Landing the *first* query character on a word start. */
const BOUNDARY = 1.5;
/**
 * Landing a later query character on a word start. Deliberately below
 * CONSECUTIVE: hopping between word starts is a real match ("gs" finding "Git:
 * Stage") but a weaker one than running contiguously, and if it scored higher
 * than contiguity then a separator-riddled string like "i-n-d-e-x.ts" would
 * outrank a clean "index.ts".
 */
const BOUNDARY_INNER = 0.9;
const CAMEL = 0.9;
/**
 * Per-character penalty for distance between two matched characters. Linear
 * and uncapped: proximity has to keep mattering at every distance, or the
 * matcher will jump arbitrarily far across a string to reach one nicer
 * character.
 */
const GAP = 0.15;

/** How the four normalized components of a single-field match are blended. */
const W_STRUCTURE = 0.55;
const W_COMPACTNESS = 0.2;
const W_POSITION = 0.15;
const W_BREVITY = 0.1;

/** Characters of offset at which the position bonus falls to half. */
const POSITION_DECAY = 12;

/**
 * How much a match in a lower-weighted field can add once the best field is
 * already accounted for. Deliberately small — an item matching weakly in
 * three fields should not outrank one matching well in the field that counts.
 */
const SECONDARY_CONTRIBUTION = 0.15;

/** One weighted, searchable string belonging to a candidate. */
export interface ScoreField {
  /** Identifies which field matched, so the caller knows what to highlight. */
  key: string;
  text: string;
  /** Relative importance, typically 0..1. */
  weight: number;
  /**
   * Case-folded `text`, one entry per code unit. Optional: pass it when the
   * same field is scored repeatedly against changing queries (a file list
   * re-ranked on every keystroke) so the fold is not redone each time.
   * Build it with {@link foldText}.
   */
  folded?: string[];
}

/** Where and how well the query matched one field. */
export interface FieldHit {
  key: string;
  /** Offsets into that field's `text`. */
  indices: number[];
  /** Match quality for this field alone, 0..1, before its weight applies. */
  score: number;
}

export interface ScoreResult {
  /**
   * Blended score across all fields, then boosted. 0..1 before `boost`;
   * a boost can push it above 1. Only meaningful relative to other
   * candidates scored against the same query.
   */
  score: number;
  /** The highest-weighted field that matched — what to highlight. */
  best: FieldHit;
  /** Every field that matched, best first. */
  hits: FieldHit[];
}

export interface ScoreOptions {
  /**
   * Extrinsic relevance applied multiplicatively as `score * (1 + boost)`:
   * recency, "this file changed in the diff", frecency. Multiplicative so the
   * bump stays proportional to match quality — a strong match on a cold item
   * still beats a weak match on a hot one, which an additive bonus cannot
   * promise.
   */
  boost?: number;
  /** Require every whitespace-separated term to match. Default true. */
  requireAllTerms?: boolean;
  /** Drop results at or below this score. Default 0 (keep everything). */
  minScore?: number;
}

/** Raw, un-normalized outcome of matching one query term against one string. */
interface RawMatch {
  raw: number;
  indices: number[];
}

// Scratch buffers, reused across calls. The matcher is synchronous and
// non-reentrant, so a single set is safe and keeps this allocation-free on
// the hot path (thousands of candidates re-scored on every keystroke).
let prevScore = new Float64Array(0);
let currScore = new Float64Array(0);
let prevRun = new Int32Array(0);
let currRun = new Int32Array(0);
let backlink = new Int32Array(0);

function ensureBuffers(m: number, n: number): void {
  if (prevScore.length < n) {
    prevScore = new Float64Array(n);
    currScore = new Float64Array(n);
    prevRun = new Int32Array(n);
    currRun = new Int32Array(n);
  }
  if (backlink.length < m * n) {
    backlink = new Int32Array(m * n);
  }
}

/**
 * Case-fold one character to a single unit.
 *
 * Whole-string `toLowerCase()` is not length-preserving in Unicode — Turkish
 * 'İ' lowercases to two code units — so folding the string wholesale and then
 * indexing into the original desynchronizes every offset past that character.
 * Folding per character keeps indices aligned with the text the caller will
 * highlight.
 */
function fold(ch: string): string {
  const lower = ch.toLowerCase();
  return lower.length === 1 ? lower : lower.charAt(0);
}

function foldAll(text: string): string[] {
  const out = new Array<string>(text.length);
  for (let i = 0; i < text.length; i++) out[i] = fold(text[i]);
  return out;
}

interface PreparedQuery {
  terms: string[];
  termsFolded: string[][];
}

// Callers loop over thousands of candidates with one query, so splitting and
// folding it per candidate was the same work repeated thousands of times.
let queryCache: { query: string; prepared: PreparedQuery } | null = null;

function prepareQuery(query: string): PreparedQuery {
  if (queryCache?.query === query) return queryCache.prepared;
  const terms = query.split(/\s+/).filter(Boolean);
  const prepared: PreparedQuery = { terms, termsFolded: terms.map(foldAll) };
  queryCache = { query, prepared };
  return prepared;
}

/**
 * What one matched character is worth at `idx`, given the length of the
 * contiguous run ending there and whether it is the query's first character.
 */
function charAward(
  text: string,
  idx: number,
  run: number,
  isFirst: boolean,
): number {
  let award = BASE;

  if (run > 1) award += CONSECUTIVE;

  if (idx === 0 || SEPARATOR.test(text[idx - 1])) {
    award += isFirst ? BOUNDARY : BOUNDARY_INNER;
  } else {
    const prev = text[idx - 1];
    const curr = text[idx];
    if (
      prev === prev.toLowerCase() &&
      curr === curr.toUpperCase() &&
      curr !== curr.toLowerCase()
    ) {
      // camelCase / PascalCase boundary — the signal that makes an initialism
      // like "fs" find "fileSlice".
      award += CAMEL;
    }
  }

  return award;
}

/**
 * Best-scoring alignment of `query` within `text`, or null if `query` is not
 * a subsequence of it.
 *
 * `blocked` marks offsets already claimed by an earlier term of a multi-term
 * query, so terms cannot both take credit for the same characters.
 */
function matchOne(
  query: string,
  queryFolded: string[],
  text: string,
  textFolded: string[],
  blocked: Set<number> | null,
): RawMatch | null {
  const m = query.length;
  const n = text.length;
  if (m === 0 || n === 0 || m > n) return null;

  // Trim to the only region that can contain a match: forward-greedy fixes
  // the earliest the last query character can land, backward-greedy the
  // latest the first one can. On a long path this can remove most of the
  // string before the quadratic part runs.
  let lo = 0;
  let hi = -1;
  {
    let qi = 0;
    for (let i = 0; i < n && qi < m; i++) {
      if (textFolded[i] === queryFolded[qi] && !blocked?.has(i)) {
        if (qi === 0) lo = i;
        qi++;
        hi = i;
      }
    }
    if (qi !== m) return null;
  }
  {
    // Walk back for how late the *last* character may land. Only `hi` comes
    // from this pass — the backward walk's view of the first character is the
    // latest it could start, which is the opposite of the bound we need.
    for (let i = n - 1; i >= 0; i--) {
      if (textFolded[i] === queryFolded[m - 1] && !blocked?.has(i)) {
        hi = i;
        break;
      }
    }
  }

  const offset = lo;
  const width = hi - lo + 1;
  ensureBuffers(m, width);

  const NEG = -Infinity;

  for (let i = 0; i < m; i++) {
    const qc = queryFolded[i];

    // `carry` is the best score for the previous query character at any
    // earlier position, already discounted for the distance to here. Folding
    // the gap penalty into a running maximum is what keeps this O(1) per
    // cell instead of scanning every earlier position.
    let carry = NEG;
    let carryIdx = -1;

    for (let j = 0; j < width; j++) {
      const abs = j + offset;

      if (i > 0 && j > 0) {
        const candidate = prevScore[j - 1];
        if (candidate > carry - GAP) {
          carry = candidate;
          carryIdx = j - 1;
        } else {
          carry = carry - GAP;
        }
      }

      if (textFolded[abs] !== qc || blocked?.has(abs)) {
        currScore[j] = NEG;
        currRun[j] = 0;
        continue;
      }

      if (i === 0) {
        currScore[j] = charAward(text, abs, 1, true);
        currRun[j] = 1;
        backlink[j] = -1;
        continue;
      }

      // Two ways to arrive: extending a consecutive run from j-1, or jumping
      // from wherever `carry` came from.
      let bestScore = NEG;
      let bestRun = 1;
      let bestFrom = -1;

      if (j > 0 && prevScore[j - 1] > NEG) {
        const run = prevRun[j - 1] + 1;
        const s = prevScore[j - 1] + charAward(text, abs, run, false);
        bestScore = s;
        bestRun = run;
        bestFrom = j - 1;
      }

      if (carry > NEG) {
        const s = carry + charAward(text, abs, 1, false);
        if (s > bestScore) {
          bestScore = s;
          bestRun = 1;
          bestFrom = carryIdx;
        }
      }

      currScore[j] = bestScore;
      currRun[j] = bestRun;
      backlink[i * width + j] = bestFrom;
    }

    // Swap rather than copy: every cell of the current row is written on
    // every path above, so the previous row's contents are already dead.
    [prevScore, currScore] = [currScore, prevScore];
    [prevRun, currRun] = [currRun, prevRun];
  }

  // Best endpoint for the final query character.
  let endJ = -1;
  let raw = NEG;
  for (let j = 0; j < width; j++) {
    if (prevScore[j] > raw) {
      raw = prevScore[j];
      endJ = j;
    }
  }
  if (endJ < 0 || raw === NEG) return null;

  const indices = new Array<number>(m);
  let j = endJ;
  for (let i = m - 1; i >= 0; i--) {
    indices[i] = j + offset;
    j = i > 0 ? backlink[i * width + j] : -1;
    if (i > 0 && j < 0) return null;
  }

  return { raw, indices };
}

/**
 * Convert a raw alignment into a 0..1 quality score.
 *
 * Every component is a ratio, which is the whole point: an absolute
 * length term (the old `100 - text.length`) is worth more than every
 * structural signal combined on a short string and nothing at all on a long
 * one, so field weights end up fighting it instead of expressing intent.
 */
function normalize(match: RawMatch, query: string, text: string): number {
  const m = query.length;
  const n = text.length;
  const first = match.indices[0];
  const last = match.indices[m - 1];

  // The best any query of this length could do: land on a word boundary and
  // run contiguously from there.
  const maxRaw = BASE + BOUNDARY + (m - 1) * (BASE + CONSECUTIVE);
  const structure = Math.max(0, Math.min(1, match.raw / maxRaw));

  const span = last - first + 1;
  const compactness = span > 0 ? m / span : 1;
  // Absolute decay, not `1 - first/length`: a length-relative measure rewards
  // matching early in a *long* string, so a deep path whose match sits in its
  // leading directories outranks a short path matching in the part that
  // actually names the thing.
  const position = 1 / (1 + first / POSITION_DECAY);
  const brevity = m / n;

  return (
    W_STRUCTURE * structure +
    W_COMPACTNESS * compactness +
    W_POSITION * position +
    W_BREVITY * brevity
  );
}

/** One field's outcome for one query term. */
interface TermFieldHit {
  key: string;
  weight: number;
  indices: number[];
  score: number;
}

/**
 * Rank one candidate, described as a set of weighted fields, against a query.
 *
 * Terms are scored **across** fields, not within one: "admin opts" should find
 * `contrib/admin/options.py` by matching "admin" in the path and "opts" in the
 * filename. Requiring every term to land in a single field would force that
 * candidate onto the lower-weighted path field alone and rank it below noise.
 *
 * Per-term scores are **averaged** rather than summed — a sum makes a two-term
 * score incomparable to a one-term score, which breaks the moment anything is
 * weighted or blended on top.
 *
 * Returns null when the candidate does not match at all — a different thing
 * from matching poorly. Keeping those distinct matters: the previous
 * implementation used a negative sentinel for "no match" and then gated on
 * `score >= 0`, so a genuine match whose penalties pushed it below zero
 * silently vanished from the results.
 */
export function scoreCandidate(
  query: string,
  fields: ScoreField[],
  opts: ScoreOptions = {},
): ScoreResult | null {
  const { boost = 0, requireAllTerms = true, minScore = 0 } = opts;

  const { terms, termsFolded } = prepareQuery(query);
  if (terms.length === 0) return null;

  const searchable = fields
    .filter((f) => f.text)
    .map((f) => ({ ...f, folded: f.folded ?? foldAll(f.text) }));
  if (searchable.length === 0) return null;

  // Characters each field has already given to an earlier term, so two terms
  // can never take credit for the same ones.
  const claimed = new Map<string, Set<number>>();
  const collected = new Map<string, { indices: number[]; score: number }>();

  let total = 0;
  let matchedTerms = 0;

  for (let t = 0; t < terms.length; t++) {
    const perField: TermFieldHit[] = [];

    for (const field of searchable) {
      const taken = claimed.get(field.key);
      const hit = matchOne(
        terms[t],
        termsFolded[t],
        field.text,
        field.folded,
        taken && taken.size > 0 ? taken : null,
      );
      if (!hit) continue;
      perField.push({
        key: field.key,
        weight: field.weight,
        indices: hit.indices,
        score: normalize(hit, terms[t], field.text),
      });
    }

    if (perField.length === 0) {
      if (requireAllTerms) return null;
      continue;
    }

    perField.sort((a, b) => b.score * b.weight - a.score * a.weight);

    // Combine as a saturating OR rather than a sum: each additional field can
    // only claim a fraction of the headroom that remains, so the result stays
    // in 0..1 and a strong primary match is never diluted by weak secondaries.
    let termScore = perField[0].score * perField[0].weight;
    for (let i = 1; i < perField.length; i++) {
      const weighted = perField[i].score * perField[i].weight;
      termScore += (1 - termScore) * SECONDARY_CONTRIBUTION * weighted;
    }

    for (const hit of perField) {
      // Claims only matter when a later term could take the same characters.
      if (terms.length > 1) {
        let taken = claimed.get(hit.key);
        if (!taken) claimed.set(hit.key, (taken = new Set()));
        for (const idx of hit.indices) taken.add(idx);
      }

      const acc = collected.get(hit.key);
      if (acc) {
        acc.indices.push(...hit.indices);
        acc.score = Math.max(acc.score, hit.score);
      } else {
        collected.set(hit.key, {
          indices: [...hit.indices],
          score: hit.score,
        });
      }
    }

    total += termScore;
    matchedTerms++;
  }

  if (matchedTerms === 0) return null;

  const weightOf = new Map(fields.map((f) => [f.key, f.weight]));
  const hits: FieldHit[] = [...collected.entries()]
    .map(([key, acc]) => ({
      key,
      indices:
        terms.length === 1
          ? acc.indices
          : [...new Set(acc.indices)].sort((a, b) => a - b),
      score: acc.score,
    }))
    .sort(
      (a, b) =>
        b.score * (weightOf.get(b.key) ?? 0) -
        a.score * (weightOf.get(a.key) ?? 0),
    );

  const score = (total / matchedTerms) * (1 + boost);
  if (score <= minScore) return null;

  return { score, best: hits[0], hits };
}

/**
 * Offsets the query matched within one field, or none if it did not match it.
 *
 * Callers render one field and highlight only that field's offsets, so this
 * lookup is the common shape rather than reading `hits` directly.
 */
export function indicesFor(result: ScoreResult, key: string): number[] {
  return result.hits.find((hit) => hit.key === key)?.indices ?? NO_INDICES;
}

const NO_INDICES: number[] = [];

/**
 * Precompute {@link ScoreField.folded} for text that outlives a single query.
 */
export function foldText(text: string): string[] {
  return foldAll(text);
}

/**
 * Convenience wrapper for the common single-string case.
 */
export function scoreText(
  query: string,
  text: string,
  opts?: ScoreOptions,
): ScoreResult | null {
  return scoreCandidate(query, [{ key: "text", text, weight: 1 }], opts);
}
