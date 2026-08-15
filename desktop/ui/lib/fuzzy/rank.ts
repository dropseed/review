import { scoreCandidate, scoreText, type ScoreField } from "./score";

/**
 * Rank a list against a query and cap it — score, drop the non-matches, best
 * first, take the top `limit`.
 *
 * The shape every picker in the app had written out for itself. Two details
 * are worth having in one place rather than four: an empty query is not a
 * ranking at all (nothing distinguishes the items, so the caller's own order
 * survives, merely capped), and a non-match is dropped rather than scored zero
 * and sorted to the bottom.
 *
 * `fieldsOf` returns a plain string for the single-field case and weighted
 * {@link ScoreField}s when several parts of an item are searchable.
 */
export function rankCandidates<T>(
  query: string,
  items: readonly T[],
  fieldsOf: (item: T) => string | ScoreField[],
  limit: number,
): T[] {
  const trimmed = query.trim();
  if (!trimmed) return items.slice(0, limit);
  return items
    .map((item) => {
      const fields = fieldsOf(item);
      const result =
        typeof fields === "string"
          ? scoreText(trimmed, fields)
          : scoreCandidate(trimmed, fields);
      return { item, score: result?.score ?? 0 };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.item);
}
