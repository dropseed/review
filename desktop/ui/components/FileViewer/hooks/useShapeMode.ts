import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileSymbol } from "../../../types";
import { stringHash } from "../../../utils/string-hash";
import { buildShapeDocument, collectFolds } from "../shape-model";
import type { ShapeViewState } from "../FileCodeView";

const NO_FOLDS_EXPANDED: ReadonlySet<string> = new Set();
const NO_LINES: readonly string[] = [];

export interface ShapeModeState {
  /** Whether the shape toggle can be offered for this file at all. */
  shapeAvailable: boolean;
  shapeMode: boolean;
  /**
   * The synthesized document plus everything the view needs to render it —
   * undefined whenever shape mode is off or unavailable.
   */
  shape: (ShapeViewState & { content: string }) | undefined;
  /** True when no fold is currently collapsed — disables "Expand all". */
  allExpanded: boolean;
  toggleShapeMode: () => void;
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
  const [shapeMode, setShapeMode] = useState(false);
  const [expandedFolds, setExpandedFolds] =
    useState<ReadonlySet<string>>(NO_FOLDS_EXPANDED);

  useEffect(() => {
    setShapeMode(false);
    setExpandedFolds(NO_FOLDS_EXPANDED);
  }, [filePath]);

  // Foldable bodies come straight from the symbol tree; a symbol without a
  // bodyStartLine simply doesn't fold, so this degrades to "nothing to fold"
  // rather than breaking while the extractor catches up.
  const folds = useMemo(
    () => (symbols ? collectFolds(symbols) : []),
    [symbols],
  );

  // `isPlainView` (i.e. `contentMode.type === "plain"`) is half the gate on
  // purpose: shape mode is only reachable for files shown without a rendered
  // diff — browse mode, unchanged files, the plain view of a changed file.
  // That is the intended scope of this spike; a diff already has its own
  // notion of what is elided.
  const shapeAvailable = isPlainView && folds.length > 0;

  const active = shapeMode && shapeAvailable && content !== undefined;

  // Split (and hash) once per file content, not once per fold toggle: only
  // `expandedFolds` changes as the user folds and unfolds.
  const lines = useMemo(
    () => (active ? (content ?? "").split("\n") : NO_LINES),
    [active, content],
  );
  const contentHash = useMemo(
    () => (active ? stringHash(content ?? "") : 0),
    [active, content],
  );

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

  const expandAllFolds = useCallback(() => {
    setExpandedFolds(new Set(folds.map((f) => f.id)));
  }, [folds]);

  const collapseAllFolds = useCallback(() => {
    setExpandedFolds(NO_FOLDS_EXPANDED);
  }, []);

  const toggleShapeMode = useCallback(() => {
    setShapeMode((prev) => !prev);
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
    shapeMode,
    shape,
    allExpanded: expandedFolds.size === folds.length,
    toggleShapeMode,
    expandAllFolds,
    collapseAllFolds,
  };
}
