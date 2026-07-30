import type { FileSymbol } from "../../types";

/**
 * "Shape" reading mode: fold every function/method body down to a single
 * elision marker so a file reads as its outline.
 *
 * The whole-file view renders through pierre's CodeView, which has no
 * fold/hidden-range API and recycles row elements while virtualizing — hiding
 * rows with CSS would corrupt both the scroll height and the element pool. So
 * instead of hiding rows we hand pierre a *smaller real document*: the file
 * with every collapsed body removed and one indent-matched marker line put in
 * its place. Virtualization stays correct because the document is real.
 *
 * The cost is that pierre then numbers that document 1..N, which is wrong.
 * Line numbers are therefore disabled in pierre (`disableLineNumbers`) and a
 * custom gutter renders the real numbers from `ShapeDocument.rows`.
 */

/** The elision marker. Chosen because highlighters leave it as plain text. */
export const SHAPE_MARKER = "⋯";

/** Bodies shorter than this aren't worth folding — the marker costs a line. */
const MIN_HIDDEN_LINES = 5;

/** A foldable function/method body, in real (1-based) file line numbers. */
export interface ShapeFold {
  /** Stable within a file+symbol set — safe to key expanded state by. */
  id: string;
  /** Symbol name, for tooltips/aria. */
  name: string;
  /** First line hidden by this fold (the signature stays visible). */
  startLine: number;
  /** Last line hidden by this fold (inclusive; usually the closing brace). */
  endLine: number;
}

/** One rendered row of the synthesized document. */
export type ShapeRow =
  | {
      kind: "code";
      /** Real (1-based) line number in the original file. */
      line: number;
      /**
       * Set when this row is the first body line of an *expanded* fold — the
       * gutter hangs the collapse affordance here, which is also the row the
       * marker occupied before expanding (so toggling never moves content).
       */
      foldId?: string;
      foldName?: string;
    }
  | {
      kind: "marker";
      foldId: string;
      foldName: string;
      /** First real line hidden behind this marker. */
      startLine: number;
      /** Last real line hidden behind this marker. */
      endLine: number;
      /** How many real lines the marker stands for. */
      hiddenLines: number;
    };

export interface ShapeDocument {
  /** The synthesized file text handed to pierre. */
  content: string;
  /** One entry per line of `content`; `rows[n - 1]` describes doc line `n`. */
  rows: ShapeRow[];
}

const FOLDABLE_KINDS = new Set<FileSymbol["kind"]>(["function", "method"]);

/**
 * Collects the function/method bodies worth folding.
 *
 * Recurses through containers (class/impl/module) so their methods fold
 * individually — folding a container would hide its members' signatures, which
 * is exactly what shape mode exists to show. Once a body is folded, nested
 * definitions inside it are skipped: only the outermost function-level fold
 * survives.
 *
 * `bodyStartLine` is optional on the wire (the Rust side may not supply it
 * yet); a symbol without one simply doesn't fold.
 */
export function collectFolds(symbols: readonly FileSymbol[]): ShapeFold[] {
  const collected: ShapeFold[] = [];

  const walk = (nodes: readonly FileSymbol[]): void => {
    for (const symbol of nodes) {
      const folded =
        FOLDABLE_KINDS.has(symbol.kind) &&
        typeof symbol.bodyStartLine === "number" &&
        symbol.bodyStartLine >= 1 &&
        symbol.endLine >= symbol.bodyStartLine &&
        symbol.endLine - symbol.bodyStartLine + 1 >= MIN_HIDDEN_LINES;

      if (folded) {
        const startLine = symbol.bodyStartLine!;
        collected.push({
          id: `${startLine}:${symbol.endLine}`,
          name: symbol.name,
          startLine,
          endLine: symbol.endLine,
        });
        // Nested defs inside a folded body are invisible anyway.
        continue;
      }

      if (symbol.children.length > 0) walk(symbol.children);
    }
  };

  walk(symbols);

  // Tree-sitter output is not guaranteed to be ordered or strictly nested;
  // overlapping folds would produce an incoherent document, so keep the first
  // (outermost) of any overlapping pair.
  collected.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const result: ShapeFold[] = [];
  let lastEnd = 0;
  for (const fold of collected) {
    if (fold.startLine <= lastEnd) continue;
    result.push(fold);
    lastEnd = fold.endLine;
  }
  return result;
}

/**
 * Builds the document pierre actually renders: the file with every collapsed
 * fold replaced by one indent-matched marker line.
 *
 * Row indices are the load-bearing part. A collapsed fold's marker sits at the
 * same row index its first body line takes when expanded, so toggling a single
 * fold never shifts anything above it and the scroll position stays put.
 */
export function buildShapeDocument(
  lines: readonly string[],
  folds: readonly ShapeFold[],
  expandedFoldIds: ReadonlySet<string>,
): ShapeDocument {
  // A trailing newline yields a phantom empty element; ignore it and restore
  // it on join so the synthesized document keeps the file's line count.
  const hasTrailingNewline = lines.length > 1 && lines[lines.length - 1] === "";
  const lineCount = hasTrailingNewline ? lines.length - 1 : lines.length;

  const foldByStart = new Map<number, ShapeFold>();
  for (const fold of folds) {
    if (fold.startLine < 1 || fold.startLine > lineCount) continue;
    foldByStart.set(fold.startLine, fold);
  }

  const outLines: string[] = [];
  const rows: ShapeRow[] = [];

  let line = 1;
  while (line <= lineCount) {
    const fold = foldByStart.get(line);
    if (fold && !expandedFoldIds.has(fold.id)) {
      const endLine = Math.min(fold.endLine, lineCount);
      outLines.push(markerLineFor(lines, line, endLine));
      rows.push({
        kind: "marker",
        foldId: fold.id,
        foldName: fold.name,
        startLine: line,
        endLine,
        hiddenLines: endLine - line + 1,
      });
      line = endLine + 1;
      continue;
    }

    outLines.push(lines[line - 1]);
    rows.push(
      fold
        ? { kind: "code", line, foldId: fold.id, foldName: fold.name }
        : { kind: "code", line },
    );
    line += 1;
  }

  const content =
    outLines.join("\n") +
    (hasTrailingNewline && outLines.length > 0 ? "\n" : "");

  return { content, rows };
}

/** Indent the marker to match the body it stands for. */
function markerLineFor(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): string {
  for (let i = startLine; i <= endLine; i++) {
    const text = lines[i - 1];
    if (text == null || text.trim() === "") continue;
    return leadingWhitespace(text) + SHAPE_MARKER;
  }
  // Whole body is blank — fall back to the signature's indent plus a step.
  const signature = lines[startLine - 2];
  return (signature ? leadingWhitespace(signature) : "") + "  " + SHAPE_MARKER;
}

function leadingWhitespace(text: string): string {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0] : "";
}

/**
 * Widest real line number in the document — sizes the custom gutter.
 *
 * Row order is monotonic in real line numbers, so the last row carries the
 * largest one: its own line for code, its hidden range's end for a marker.
 */
export function maxRealLine(rows: readonly ShapeRow[]): number {
  const last = rows[rows.length - 1];
  if (!last) return 0;
  return last.kind === "code" ? last.line : last.endLine;
}
