import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileSymbol } from "../../../types";
import { stringHash } from "../../../utils/string-hash";
import {
  buildShapeDocument,
  collectFolds,
  type ShapeFold,
} from "../shape-model";
import type { ShapeViewState } from "../FileCodeView";

const NO_FOLDS_EXPANDED: ReadonlySet<string> = new Set();
const NO_LINES: readonly string[] = [];
const NO_FOLDS: readonly ShapeFold[] = [];

export interface ShapeModeState {
  /** Whether the shape toggle can be offered for this file at all. */
  shapeAvailable: boolean;
  /**
   * Whether the view is *actually* being rendered as a folded document — the
   * one flag anything keyed to shape mode should read. The toggle can stay on
   * while availability goes away (a plain file gains hunks), and a suppression
   * keyed to the raw toggle would then outlive the folding it was suppressing.
   */
  shapeMode: boolean;
  /**
   * The synthesized document plus everything the view needs to render it —
   * undefined whenever shape mode is off or unavailable.
   */
  shape: (ShapeViewState & { content: string }) | undefined;
  /** True when no fold is currently collapsed — disables "Expand all". */
  allExpanded: boolean;
  toggleShapeMode: () => void;
  /** Open one fold, so a jump into a hidden line can reveal its target. */
  expandFold: (foldId: string) => void;
  expandAllFolds: () => void;
  collapseAllFolds: () => void;
}

/**
 * Shape ("outline") reading mode for the whole-file view: every function or
 * method body folded to a single `⋯` marker. See `shape-model.ts` for why the
 * folded document is synthesized rather than hidden with CSS.
 */
export function useShapeMode({
  filePath,
  content,
  symbols,
  isPlainView,
}: {
  filePath: string;
  /** The file's text, or undefined while it is still loading. */
  content: string | undefined;
  symbols: FileSymbol[] | null;
  /** Whether the file is being rendered as a whole file rather than a diff. */
  isPlainView: boolean;
}): ShapeModeState {
  // Deliberately component state, like svgViewMode and markdownViewMode: a
  // per-file, ephemeral reading posture that resets on every file switch and is
  // never persisted. Promoting it to a store slice becomes necessary the moment
  // it wants to be an APP_COMMANDS palette entry — commands run against the
  // store, not against one component's local state.
  const [enabled, setEnabled] = useState(false);
  const [expandedFolds, setExpandedFolds] =
    useState<ReadonlySet<string>>(NO_FOLDS_EXPANDED);

  useEffect(() => {
    setEnabled(false);
    setExpandedFolds(NO_FOLDS_EXPANDED);
  }, [filePath]);

  // `isPlainView` (i.e. `contentMode.type === "plain"`) is half the gate on
  // purpose: shape mode is only reachable for files shown without a rendered
  // diff — browse mode, unchanged files, the plain view of a changed file.
  // That is the intended scope of this spike; a diff already has its own
  // notion of what is elided.
  const foldable = isPlainView && symbols !== null && content !== undefined;

  // Split (and hash) once per file content, not once per fold toggle: only
  // `expandedFolds` changes as the user folds and unfolds.
  const lines = useMemo(
    () => (foldable ? (content ?? "").split("\n") : NO_LINES),
    [foldable, content],
  );
  const contentHash = useMemo(
    () => (foldable ? stringHash(content ?? "") : 0),
    [foldable, content],
  );

  // Foldable bodies come straight from the symbol tree; a symbol without a
  // bodyStartLine simply doesn't fold, so this degrades to "nothing to fold"
  // rather than breaking while the extractor catches up.
  const folds = useMemo(
    () => (foldable && symbols ? collectFolds(symbols, lines) : NO_FOLDS),
    [foldable, symbols, lines],
  );

  // Fold ids are line ranges, so a file that changes under the same path can
  // leave ids behind that no longer name anything. Dropping them here keeps
  // both the set and `allExpanded` describing the folds that actually exist.
  // Only against a real fold list, though: while symbols are away (a refetch
  // after the text changed) `folds` is NO_FOLDS — "don't know yet", not "none
  // exist" — and pruning against it would erase every fold the user opened.
  useEffect(() => {
    if (!foldable) return;
    setExpandedFolds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(folds.map((f) => f.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [foldable, folds]);

  const shapeAvailable = foldable && folds.length > 0;
  const active = enabled && shapeAvailable;

  const shapeDocument = useMemo(
    () => (active ? buildShapeDocument(lines, folds, expandedFolds) : null),
    [active, lines, folds, expandedFolds],
  );

  const toggleFold = useCallback((foldId: string) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (!next.delete(foldId)) next.add(foldId);
      return next;
    });
  }, []);

  const expandFold = useCallback((foldId: string) => {
    setExpandedFolds((prev) =>
      prev.has(foldId) ? prev : new Set(prev).add(foldId),
    );
  }, []);

  const expandAllFolds = useCallback(() => {
    setExpandedFolds(new Set(folds.map((f) => f.id)));
  }, [folds]);

  const collapseAllFolds = useCallback(() => {
    setExpandedFolds(NO_FOLDS_EXPANDED);
  }, []);

  const toggleShapeMode = useCallback(() => {
    setEnabled((prev) => !prev);
    setExpandedFolds(NO_FOLDS_EXPANDED);
  }, []);

  const shape = useMemo(() => {
    if (!shapeDocument) return undefined;
    // The document is exactly (file content × which folds are open), so that
    // pair is its cache key — the code view then never re-hashes the whole
    // synthesized text on a toggle.
    const openFolds = [...expandedFolds].sort().join(",");
    return {
      content: shapeDocument.content,
      rows: shapeDocument.rows,
      onToggleFold: toggleFold,
      cacheKey: `${contentHash}:${openFolds}`,
    };
  }, [shapeDocument, expandedFolds, contentHash, toggleFold]);

  return {
    shapeAvailable,
    shapeMode: shape !== undefined,
    shape,
    allExpanded: expandedFolds.size === folds.length,
    toggleShapeMode,
    expandFold,
    expandAllFolds,
    collapseAllFolds,
  };
}
