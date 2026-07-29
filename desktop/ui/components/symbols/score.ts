import { scoreCandidate, indicesFor } from "../../lib/fuzzy";

/** The parts of a symbol that ranking looks at, whatever else it carries. */
export interface ScorableSymbol {
  name: string;
  parentName: string | null;
  /** Whether the diff touched this symbol. */
  changed?: boolean;
}

/** How a symbol's own name outweighs the container it sits in. */
const NAME_WEIGHT = 1;
const PARENT_WEIGHT = 0.4;
/** Proportional bump for symbols the comparison actually touched. */
const CHANGED_BOOST = 0.2;

export interface SymbolScore {
  score: number;
  /** Offsets into `name` — the only text a symbol row renders. */
  matchIndices: number[];
}

/**
 * Rank one symbol against a query.
 *
 * Shared by every symbol surface — the ⌘R finder, the repo-wide panel, and the
 * outline filter — so they cannot quietly disagree about what a good match is.
 * They previously carried three copies of this, with different weights.
 */
export function scoreSymbol(
  query: string,
  symbol: ScorableSymbol,
): SymbolScore | null {
  const result = scoreCandidate(
    query,
    [
      { key: "name", text: symbol.name, weight: NAME_WEIGHT },
      {
        key: "parent",
        text: symbol.parentName ?? "",
        weight: PARENT_WEIGHT,
      },
    ],
    { boost: symbol.changed ? CHANGED_BOOST : 0 },
  );
  if (!result) return null;

  return { score: result.score, matchIndices: indicesFor(result, "name") };
}
