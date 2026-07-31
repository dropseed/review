import { activeContentOverlay } from "../../stores/slices/navigationSlice";
/**
 * The pure half of file-list multi-select and of "which file is the sidebar
 * pointing at".
 *
 * Selection is expressed against the list's *visual order* — the flattened,
 * sorted, expansion-aware sequence of rows actually on screen — because
 * shift-click means "everything between these two rows as I see them", not
 * "everything between them in the underlying tree". The component layer hands
 * that order in; everything here is data in, data out, so the rules are
 * testable without rendering a tree.
 */

/** What a click means, derived from its modifier keys. */
export type SelectionModifier = "replace" | "toggle" | "range";

/**
 * The row a shift-click extends from, and the list it was clicked in.
 *
 * The section has to be part of it: the status sections overlap by path by
 * design — a file with one pending hunk and three trusted ones is a row in
 * both "Needs review" and "Trusted" — so a bare path can't say which list a
 * range should run through. Identity by path alone lets an anchor set in one
 * section answer for the same file in another, and the range then sweeps a
 * section the user never clicked in.
 */
export interface SelectionAnchor {
  readonly path: string;
  /** Opaque id of the section the anchor row was clicked in. */
  readonly section: string;
}

export interface FileSelection {
  /** Selected file paths, ordered to match the list they were picked from. */
  readonly paths: readonly string[];
  /** The row a shift-click extends from, or null when there's nothing to extend. */
  readonly anchor: SelectionAnchor | null;
}

export const EMPTY_SELECTION: FileSelection = { paths: [], anchor: null };

/** A selection of one is just "the current file" — only 2+ is a multi-select. */
export function isMultiSelection(selection: FileSelection): boolean {
  return selection.paths.length >= 2;
}

export function selectionModifier(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): SelectionModifier {
  if (event.shiftKey) return "range";
  // Cmd on macOS, Ctrl elsewhere — both accepted everywhere rather than
  // sniffing the platform, since either one unambiguously means "toggle".
  if (event.metaKey || event.ctrlKey) return "toggle";
  return "replace";
}

/**
 * Re-sequence a set of paths: anything the current list knows about takes that
 * list's order, anything left (picked up in another section) keeps its previous
 * relative order at the end. Keeps the selection's order stable and meaningful
 * so the rolling diff lists files the way the sidebar does.
 */
function orderPaths(
  wanted: Set<string>,
  previous: readonly string[],
  order: readonly string[],
): string[] {
  const result: string[] = [];
  for (const path of order) {
    if (wanted.delete(path)) result.push(path);
  }
  for (const path of previous) {
    if (wanted.delete(path)) result.push(path);
  }
  return result;
}

/**
 * Apply a click to the current selection.
 *
 * `order` is the visual order of the *section that was clicked*, and `section`
 * identifies that section — only its rows can be range-selected, which keeps a
 * shift-click from silently sweeping across a neighbouring section. Rows
 * missing from `order` (directories, and files with no hunks to act on) aren't
 * selectable at all; clicking one resets to a plain single selection.
 */
export function applySelectionClick(
  current: FileSelection,
  path: string,
  modifier: SelectionModifier,
  order: readonly string[],
  section: string,
): FileSelection {
  const clicked: SelectionAnchor = { path, section };
  if (modifier === "replace" || !order.includes(path)) {
    return { paths: [path], anchor: clicked };
  }

  if (modifier === "toggle") {
    const wanted = new Set(current.paths);
    if (!wanted.delete(path)) wanted.add(path);
    return { paths: orderPaths(wanted, current.paths, order), anchor: clicked };
  }

  // Range. With no usable anchor there's nothing to extend from, so the click
  // adds itself and becomes the anchor for the next shift-click. An anchor
  // from another section is not usable here even when this section happens to
  // list the same file — the row it named isn't one of these rows.
  const anchor =
    current.anchor !== null &&
    current.anchor.section === section &&
    order.includes(current.anchor.path)
      ? current.anchor
      : null;
  if (anchor === null) {
    const wanted = new Set(current.paths);
    wanted.add(path);
    return { paths: orderPaths(wanted, current.paths, order), anchor: clicked };
  }

  // A range replaces the selection rather than adding to it (matching every
  // other list on the machine), and leaves the anchor put so repeated
  // shift-clicks grow and shrink the same range.
  const from = order.indexOf(anchor.path);
  const to = order.indexOf(path);
  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return { paths: range, anchor };
}

/**
 * Drop selected paths that no longer exist, and collapse to nothing once
 * fewer than two survive — a leftover single would keep the multi-select
 * styling alive with nothing to act on. Returns the input unchanged when
 * nothing was dropped, so this is safe to run from an effect.
 */
export function pruneSelection(
  current: FileSelection,
  available: ReadonlySet<string>,
): FileSelection {
  const paths = current.paths.filter((p) => available.has(p));
  if (paths.length === current.paths.length) return current;
  if (paths.length < 2) return EMPTY_SELECTION;
  const anchor = current.anchor;
  return {
    paths,
    // A dropped anchor re-anchors inside the section it was set in: the
    // section is still on screen even though that one row left it.
    anchor:
      anchor === null || available.has(anchor.path)
        ? anchor
        : { path: paths[0], section: anchor.section },
  };
}

/** Minimal shape of a tree row, so the walk is testable without a real tree. */
export interface SelectableTreeEntry {
  path: string;
  isDirectory: boolean;
  matchesFilter: boolean;
  hunkStatus: { total: number };
  children?: readonly SelectableTreeEntry[];
}

/**
 * The file rows a tree section actually shows, top to bottom: filtered-out
 * entries are skipped, collapsed directories hide their subtree, and
 * directories themselves are omitted.
 *
 * Directory rows are deliberately not selectable. They already cascade
 * approve to everything beneath them, and a range that contains a directory
 * has no single sane reading — does it mean the directory, its visible
 * children, or its hidden ones too? Restricting ranges to file rows keeps
 * "these ten files" exact; directory approve is unchanged and still one click.
 */
export function flattenVisibleFilePaths(
  entries: readonly SelectableTreeEntry[],
  expandedPaths: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];
  const walk = (items: readonly SelectableTreeEntry[]): void => {
    for (const entry of items) {
      if (!entry.matchesFilter) continue;
      if (entry.isDirectory) {
        if (entry.children && expandedPaths.has(entry.path))
          walk(entry.children);
        continue;
      }
      // Rows with nothing to approve stay out of the order: they'd contribute
      // no hunks to a bulk action and no diff to the rolling view.
      if (entry.hunkStatus.total > 0) paths.push(entry.path);
    }
  };
  walk(entries);
  return paths;
}

/** Every hunk in the selected files, in selection order. */
export function selectionHunkIds(
  paths: readonly string[],
  hunksForPath: (path: string) => readonly { id: string }[] | undefined,
): string[] {
  const ids: string[] = [];
  for (const path of paths) {
    for (const hunk of hunksForPath(path) ?? []) ids.push(hunk.id);
  }
  return ids;
}

/**
 * The selection's hunks re-read from the current diff, or null when they still
 * match `current`.
 *
 * A hunk id is `filepath:contentHash`, so editing a file retires every id it
 * had. A set of ids captured when the rows were clicked therefore stops
 * covering the files it was picked for the moment anything is re-diffed — the
 * file drops out of the rolling diff while its row stays selected, and a bulk
 * approve driven by the snapshot silently skips it. The paths are the durable
 * part of a selection; the ids have to be derived from them each time.
 */
export function refreshedHunkIds(
  current: readonly string[],
  paths: readonly string[],
  hunksForPath: (path: string) => readonly { id: string }[] | undefined,
): string[] | null {
  const next = selectionHunkIds(paths, hunksForPath);
  if (
    next.length === current.length &&
    next.every((id, i) => id === current[i])
  ) {
    return null;
  }
  return next;
}

/**
 * Whether the content area is showing the diff panes at all. Every overlay
 * takes the whole region ahead of the panes (see ContentArea), so any one of
 * them being open means there are no panes to point at.
 *
 * Asks `activeContentOverlay` rather than naming the overlays itself: taking
 * them as positional arguments is what let a third one be added without this
 * predicate hearing about it, leaving the sidebar marking "you are here" on a
 * file whose pane was not on screen.
 */
export function arePanesOnScreen(
  state: Parameters<typeof activeContentOverlay>[0],
): boolean {
  return activeContentOverlay(state) === null;
}

export interface PaneFiles {
  /** The file in the pane that currently has focus — the sidebar's "you are here". */
  activePath: string | null;
  /** The other open pane's file, if a split is open and showing something else. */
  companionPath: string | null;
}

/**
 * Which file the sidebar should point at, given the two diff panes.
 *
 * The highlighted row follows focus: with the split's pane focused, the
 * sidebar points at the split's file, because that's the one the next hunk
 * key or approve press acts on. The unfocused pane's file gets a weaker mark
 * rather than nothing — both files are on screen, and a sidebar that admits
 * to only one of them makes the other look closed.
 *
 * `panesOnScreen` is what makes any of that true. A rolling diff (a guide
 * group, an ad-hoc selection, the working tree) replaces the panes wholesale
 * while `secondaryFile` and `focusedPane` keep their last values, so without
 * it the sidebar would point confidently at a file that isn't rendered
 * anywhere — outranking the rows the reader actually picked.
 */
export function resolvePaneFiles(
  selectedFile: string | null,
  secondaryFile: string | null,
  focusedPane: "primary" | "secondary",
  panesOnScreen: boolean,
): PaneFiles {
  if (!panesOnScreen) return { activePath: null, companionPath: null };

  // "" is the empty-split placeholder: a second pane is open but holds no file.
  const isSplitActive = secondaryFile !== null && secondaryFile !== "";
  if (!isSplitActive) {
    return { activePath: selectedFile, companionPath: null };
  }

  const activePath = focusedPane === "secondary" ? secondaryFile : selectedFile;
  const other = focusedPane === "secondary" ? selectedFile : secondaryFile;
  return {
    activePath,
    // Same file in both panes is one row; marking it twice says nothing.
    companionPath: other === activePath ? null : other,
  };
}
