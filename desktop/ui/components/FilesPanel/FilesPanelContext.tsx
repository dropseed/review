import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSpurStore } from "../../stores";
import type { HunkGroup } from "../../types";
import type { FileHunkStatus } from "./types";
import {
  EMPTY_SELECTION,
  applySelectionClick,
  isMultiSelection,
  pruneSelection,
  refreshedHunkIds,
  selectionHunkIds,
  selectionModifier,
  type FileSelection,
} from "./fileSelection";

interface FilesPanelContextValue {
  expandedPaths: Set<string>;
  togglePath: (path: string, isGitignored?: boolean) => void;
  selectedFile: string | null;
  handleSelectFile: (path: string) => void;
  repoPath: string | null;
  openInSplit: (filePath: string) => void;
  registerRef: (path: string, el: HTMLButtonElement | null) => void;
  handleApproveAll: (path: string, isDir: boolean) => void;
  handleUnapproveAll: (path: string, isDir: boolean) => void;
  handleRejectAll: (path: string, isDir: boolean) => void;
  movedFilePaths: Set<string>;
  hunkStatusMap: Map<string, FileHunkStatus>;
  fileStatusMap: Map<string, string>;
  symlinkMap: Map<string, string | undefined>;
  expandAll: (dirPaths: Set<string>, excludePaths?: Set<string>) => void;
  collapseAll: () => void;
  grayscaleIcons?: boolean;
  showRevealInBrowse?: boolean;
}

const FilesPanelContext = createContext<FilesPanelContextValue | null>(null);

export const FilesPanelProvider = FilesPanelContext.Provider;

export function useFilesPanelContext(): FilesPanelContextValue {
  const ctx = use(FilesPanelContext);
  if (!ctx) {
    throw new Error(
      "useFilesPanelContext must be used within a FilesPanelProvider",
    );
  }
  return ctx;
}

interface FileSelectionContextValue {
  /** Paths in the current multi-selection (empty unless 2+ rows are picked). */
  selectedPaths: ReadonlySet<string>;
  isMultiSelect: boolean;
  /**
   * Route a row click through the selection. Returns true when the click was
   * a multi-select gesture and has already been dealt with (including any
   * navigation it implies) — a false means "plain click, carry on".
   */
  handleRowClick: (
    path: string,
    order: readonly string[],
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    /** Identifies the section the row lives in; ranges never leave it. */
    section: string,
  ) => boolean;
  approveSelection: () => void;
  unapproveSelection: () => void;
}

/**
 * Inert default so rows outside a selection provider (the Browse tab's tree)
 * keep behaving exactly as they did — plain clicks, no selection state.
 */
const NO_SELECTION: FileSelectionContextValue = {
  selectedPaths: new Set(),
  isMultiSelect: false,
  handleRowClick: () => false,
  approveSelection: () => {},
  unapproveSelection: () => {},
};

const FileSelectionContext =
  createContext<FileSelectionContextValue>(NO_SELECTION);

/**
 * Multi-select for the Review tab's file list.
 *
 * Lives here rather than in the store because it is a property of one list on
 * one screen: it means nothing once that list unmounts, and no other surface
 * reads it. It sits in its own provider (rather than in FilesPanelContext's
 * value) so it can wrap just the status sections, which is the run of rows a
 * range is allowed to span.
 *
 * With two or more rows picked, the selection drives the content area: it
 * opens the same ad-hoc rolling diff the "view as rolling diff" menu items
 * use, so the header's "Approve all" already acts on exactly the selection.
 */
export function FileSelectionProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { handleSelectFile } = useFilesPanelContext();
  const [selection, setSelection] = useState<FileSelection>(EMPTY_SELECTION);

  // The exact group object handed to the store, so we can tell "our rolling
  // diff is still on screen" from "the user opened something else".
  const openedGroup = useRef<HunkGroup | null>(null);

  const guideContentMode = useSpurStore((s) => s.guideContentMode);
  const adhocGroup = useSpurStore((s) => s.adhocGroup);
  const comparison = useSpurStore((s) => s.comparison);
  const filesByPath = useSpurStore((s) => s.filesByPath);

  const openSelection = useCallback((paths: readonly string[]) => {
    const store = useSpurStore.getState();
    const hunkIds = selectionHunkIds(
      paths,
      (path) => store.filesByPath[path]?.hunks,
    );
    if (hunkIds.length === 0) return;
    const group: HunkGroup = {
      title: `${paths.length} selected files`,
      hunkIds,
    };
    openedGroup.current = group;
    store.openAdhocGroup(group);
  }, []);

  const handleRowClick = useCallback<
    FileSelectionContextValue["handleRowClick"]
  >(
    (path, order, event, section) => {
      const modifier = selectionModifier(event);
      const next = applySelectionClick(
        selection,
        path,
        modifier,
        order,
        section,
      );
      setSelection(next);

      if (modifier === "replace") return false;

      // A modifier click owns what the content area shows: many files means
      // the rolling diff, one means that file, none means leave it be.
      if (next.paths.length >= 2) openSelection(next.paths);
      else if (next.paths.length === 1) handleSelectFile(next.paths[0]);
      return true;
    },
    [selection, openSelection, handleSelectFile],
  );

  const selectedHunkIds = useCallback(() => {
    const store = useSpurStore.getState();
    return selectionHunkIds(
      selection.paths,
      (path) => store.filesByPath[path]?.hunks,
    );
  }, [selection.paths]);

  // One store write for the whole selection rather than one per file: the
  // per-file actions each persist the review, and ten of those in a row is
  // ten chances to lose a race with the file watcher.
  const approveSelection = useCallback(() => {
    const ids = selectedHunkIds();
    if (ids.length > 0) useSpurStore.getState().approveHunkIds(ids);
  }, [selectedHunkIds]);

  const unapproveSelection = useCallback(() => {
    const ids = selectedHunkIds();
    if (ids.length > 0) useSpurStore.getState().unapproveHunkIds(ids);
  }, [selectedHunkIds]);

  // Keep the open rolling diff on the *current* hunks of the selected files.
  // Its hunk ids were resolved when the rows were clicked, and a hunk id is
  // content-addressed — one edit to a selected file and every id it had is
  // gone, so the file would silently vanish from the rolling diff (and from
  // its "Approve all") while its row stayed selected. The paths are what the
  // user picked; the ids follow the diff.
  useEffect(() => {
    const group = openedGroup.current;
    if (!group || adhocGroup !== group) return;
    if (!isMultiSelection(selection)) return;
    const hunkIds = refreshedHunkIds(
      group.hunkIds,
      selection.paths,
      (path) => filesByPath[path]?.hunks,
    );
    if (hunkIds === null || hunkIds.length === 0) return;
    const next: HunkGroup = { ...group, hunkIds };
    openedGroup.current = next;
    // Not openAdhocGroup: the group is already open, and re-opening it would
    // clear overlays and navigation out from under the reader.
    useSpurStore.setState({ adhocGroup: next });
  }, [filesByPath, adhocGroup, selection]);

  // Navigating anywhere else drops the selection: once the content area is no
  // longer showing the selection's own rolling diff, highlighted rows in the
  // sidebar would be pointing at nothing.
  useEffect(() => {
    if (!isMultiSelection(selection)) return;
    const showingSelection =
      guideContentMode === "adhoc-group" && adhocGroup === openedGroup.current;
    if (!showingSelection) setSelection(EMPTY_SELECTION);
  }, [guideContentMode, adhocGroup, selection]);

  // A new comparison is a different set of files entirely.
  useEffect(() => {
    setSelection(EMPTY_SELECTION);
  }, [comparison]);

  // Files that dropped out of the diff (re-diff, watcher update) drop out of
  // the selection with it.
  useEffect(() => {
    setSelection((prev) =>
      pruneSelection(prev, new Set(Object.keys(filesByPath))),
    );
  }, [filesByPath]);

  const value = useMemo<FileSelectionContextValue>(() => {
    const multi = isMultiSelection(selection);
    return {
      selectedPaths: multi ? new Set(selection.paths) : new Set<string>(),
      isMultiSelect: multi,
      handleRowClick,
      approveSelection,
      unapproveSelection,
    };
  }, [selection, handleRowClick, approveSelection, unapproveSelection]);

  return <FileSelectionContext value={value}>{children}</FileSelectionContext>;
}

export function useFileSelection(): FileSelectionContextValue {
  return use(FileSelectionContext);
}
