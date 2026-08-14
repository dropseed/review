import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Dialog, DialogContent } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { SearchIcon, XIcon } from "../ui/icons";

/** A run of items under an optional sticky header. */
export interface PaletteGroup<T> {
  key: string;
  header?: ReactNode;
  items: T[];
}

/** One `<kbd>`-annotated hint in the footer. */
interface PaletteHint {
  keys: string[];
  label: string;
}

export interface PaletteDialogProps<T> {
  open: boolean;
  onClose: () => void;
  /** Announced as the dialog's name; visually hidden. */
  title: string;

  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  /** Called by the clear button. Defaults to clearing the query. */
  onClear?: () => void;
  /** Select the existing text on open, for a pre-filled query. */
  selectOnOpen?: boolean;
  /**
   * What the selection resets on. Defaults to the query, which is right when
   * the query is the only thing that changes what is listed — a caller that
   * swaps the whole result set out from under an unchanged query has to say so.
   */
  resetSelectionOn?: string;

  /** Flat items, or `groups` for headered sections. Provide exactly one. */
  items?: T[];
  groups?: PaletteGroup<T>[];
  getKey: (item: T) => string;
  renderRow: (item: T, state: { selected: boolean }) => ReactNode;
  onActivate: (item: T) => void;
  /**
   * ⌘Enter — "the same destination, plus the thing you were going to do when
   * you got there".
   *
   * A second verb on the row the cursor is already on, rather than a mode of
   * its own: the row is the noun either way, and a mode would make the user
   * decide which list they are in before they have found the entry. Rows that
   * have no second verb simply ignore it.
   */
  onAlternateActivate?: (item: T) => void;
  /** Verb shown next to the ⌘Enter hint. Omitted hides the hint. */
  alternateLabel?: string;

  busy?: boolean;
  error?: string | null;
  /** Shown when there is nothing to list and no error. */
  emptyMessage: ReactNode;

  /** Extra controls in the input row, before the spinner/clear button. */
  inputAccessories?: ReactNode;
  /** Rendered ahead of the input, in place of the search icon. */
  inputPrefix?: ReactNode;
  /**
   * Runs before the shell's own Arrow/Enter/Escape handling. Return true to
   * claim the keystroke.
   */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => boolean;

  /** Verb shown next to the Enter hint. Defaults to "select". */
  enterLabel?: string;
  /** Right-hand footer summary. Defaults to "N results". */
  renderCount?: (count: number) => ReactNode;
  /** Extra hints after the built-in navigate/select/close trio. */
  footerHints?: ReactNode;

  /** Dialog width and list height together — code lines need the extra room. */
  size?: "md" | "lg";
}

/**
 * Everything about the dialog that depends on *what* is being searched.
 *
 * Derived from the props rather than restated so the two cannot drift, and so a
 * new dialog capability is available to every mode by default. The complement —
 * `open`, `query`, and the mode chrome — belongs to whoever owns the palette,
 * which is what lets one mounted dialog swap between modes.
 */
export type PaletteSource<T> = Pick<
  PaletteDialogProps<T>,
  | "title"
  | "placeholder"
  | "items"
  | "groups"
  | "getKey"
  | "renderRow"
  | "onActivate"
  | "onAlternateActivate"
  | "alternateLabel"
  | "busy"
  | "error"
  | "emptyMessage"
  | "renderCount"
  | "enterLabel"
  | "size"
  | "inputAccessories"
  | "onKeyDown"
  | "onClear"
  | "selectOnOpen"
>;

const SIZES = {
  md: { width: "max-w-xl", list: "max-h-80" },
  lg: { width: "max-w-2xl", list: "max-h-96" },
} as const;

/** Marks the sticky header the keyboard cursor has to clear when scrolling. */
export const PALETTE_HEADER_ATTR = "data-palette-header";

/** "1 file" / "3 files" — for the footer count. */
export function countLabel(
  count: number,
  noun: string,
  plural = `${noun}s`,
): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

/**
 * Scroll `el` into view **within `container` only**.
 *
 * Deliberately not `element.scrollIntoView()`: that is allowed to scroll any
 * ancestor scroller, including the document, which in a floating panel drags
 * the whole page out from under the user.
 */
function scrollWithin(container: HTMLElement, el: HTMLElement): void {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();

  // A group header is sticky, so the row has to clear it rather than the
  // container's top edge. Measured rather than passed in: a hand-tuned pixel
  // constant silently goes wrong the moment a header is restyled or the UI
  // scale changes.
  const header = container.querySelector<HTMLElement>(
    `[${PALETTE_HEADER_ATTR}]`,
  );
  const top = c.top + (header?.offsetHeight ?? 0);

  if (r.top < top) {
    container.scrollTop -= top - r.top;
  } else if (r.bottom > c.bottom) {
    container.scrollTop += r.bottom - c.bottom;
  }
}

/**
 * The shared shell behind every search-and-pick surface in the app: the file
 * finder, content search, symbol search, and the command palette.
 *
 * It owns the parts that were previously reimplemented per surface and had
 * drifted — the Radix dialog chrome, keyboard navigation, scrolling, and the
 * combobox ARIA contract. Most importantly it owns the mapping between the
 * flat selection index and the rendered rows: when a caller groups results,
 * the index the arrow keys move through and the index a row reports on click
 * are derived from one array here, so they cannot disagree.
 */
export function PaletteDialog<T>({
  open,
  onClose,
  title,
  query,
  onQueryChange,
  placeholder,
  onClear,
  selectOnOpen = false,
  resetSelectionOn,
  items,
  groups,
  getKey,
  renderRow,
  onActivate,
  busy = false,
  error = null,
  emptyMessage,
  inputAccessories,
  inputPrefix,
  onKeyDown,
  onAlternateActivate,
  alternateLabel,
  enterLabel = "select",
  renderCount,
  footerHints,
  size = "md",
}: PaletteDialogProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  // One array is the truth for both navigation and rendering. Callers that
  // group are handed slices of this same list, with the flat offset each
  // group starts at, so a row's index is never recomputed independently.
  const { flat, sections } = useMemo(() => {
    const source: PaletteGroup<T>[] = groups ?? [
      { key: "all", items: items ?? [] },
    ];
    const flattened: T[] = [];
    const built = source.map((group) => {
      const offset = flattened.length;
      flattened.push(...group.items);
      return { ...group, offset };
    });
    return { flat: flattened, sections: built };
  }, [groups, items]);

  const [selectedIndex, setSelectedIndex] = useSelection(
    flat.length,
    resetSelectionOn ?? query,
  );

  const optionId = useCallback(
    (index: number) => `${baseId}-option-${index}`,
    [baseId],
  );
  const groupId = useCallback(
    (key: string) => `${baseId}-group-${key}`,
    [baseId],
  );
  const listId = `${baseId}-listbox`;

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (selectOnOpen) inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, selectOnOpen]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    if (el) scrollWithin(container, el);
  }, [selectedIndex]);

  const activate = useCallback(
    (index: number) => {
      const item = flat[index];
      if (!item) return;
      onActivate(item);
    },
    [flat, onActivate],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (onKeyDown?.(event)) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flat.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Home":
          if (!event.metaKey && !event.ctrlKey) return;
          event.preventDefault();
          setSelectedIndex(0);
          break;
        case "End":
          if (!event.metaKey && !event.ctrlKey) return;
          event.preventDefault();
          setSelectedIndex(Math.max(0, flat.length - 1));
          break;
        case "Enter": {
          const item = flat[selectedIndex];
          if (!item) return;
          // ⌘Enter is the row's second verb when the mode offers one.
          if ((event.metaKey || event.ctrlKey) && onAlternateActivate) {
            event.preventDefault();
            onAlternateActivate(item);
            return;
          }
          // Otherwise only a bare Enter activates. A modified Enter belongs to
          // whatever global shortcut owns that chord, and would otherwise fire
          // both.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          activate(selectedIndex);
          break;
        }
      }
    },
    [
      activate,
      flat,
      onAlternateActivate,
      onKeyDown,
      selectedIndex,
      setSelectedIndex,
    ],
  );

  // The error branch renders in place of the list, so there are no options to
  // point at even when the previous result set is still in state.
  const hasResults = !error && flat.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className={`w-full ${SIZES[size].width} rounded-xl overflow-hidden`}
        overlayClassName="items-start pt-[15vh]"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // The listbox and its hints describe the dialog; an extra description
        // would only be read out ahead of them.
        aria-describedby={undefined}
      >
        <VisuallyHidden.Root>
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
        </VisuallyHidden.Root>
        <div>
          <div className="border-b border-edge p-3">
            <div className="flex items-center gap-3 px-2">
              {inputPrefix ?? (
                <SearchIcon className="h-4 w-4 text-fg-muted flex-shrink-0" />
              )}
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={hasResults}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  hasResults ? optionId(selectedIndex) : undefined
                }
                aria-label={title}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="flex-1 bg-transparent text-sm text-fg placeholder-fg-muted focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring/50 rounded px-1 py-1"
              />
              {inputAccessories}
              {busy && (
                <Spinner className="h-4 w-4 border-2 border-edge-strong border-t-fg-secondary" />
              )}
              {query && !busy && (
                <button
                  onClick={() => (onClear ? onClear() : onQueryChange(""))}
                  className="text-fg-muted hover:text-fg-secondary transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring/50 rounded"
                  aria-label="Clear search"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div
            ref={listRef}
            id={listId}
            className={`${SIZES[size].list} overflow-y-auto scrollbar-thin`}
            role="listbox"
            aria-label={title}
          >
            {error ? (
              <div className="px-4 py-8 text-center text-sm text-status-rejected">
                {error}
              </div>
            ) : !hasResults ? (
              <div className="px-4 py-8 text-center text-sm text-fg-muted">
                {emptyMessage}
              </div>
            ) : (
              sections.map((section) => (
                <div
                  key={section.key}
                  role={section.header ? "group" : undefined}
                  aria-labelledby={
                    section.header ? groupId(section.key) : undefined
                  }
                >
                  {section.header && (
                    <div id={groupId(section.key)}>{section.header}</div>
                  )}
                  {section.items.map((item, i) => {
                    const index = section.offset + i;
                    const selected = index === selectedIndex;
                    return (
                      <div
                        key={getKey(item)}
                        id={optionId(index)}
                        data-index={index}
                        role="option"
                        aria-selected={selected}
                        onClick={() => activate(index)}
                        // mousemove, not mouseenter: scrolling the list
                        // under a stationary pointer should not yank the
                        // keyboard cursor to wherever it happens to rest.
                        onMouseMove={() => setSelectedIndex(index)}
                        className={`w-full cursor-pointer transition-colors ${
                          selected
                            ? "bg-surface-raised"
                            : "hover:bg-surface-raised/50"
                        }`}
                      >
                        {renderRow(item, { selected })}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-edge px-4 py-2 text-xxs text-fg-faint">
            {/* Wraps rather than clipping: the root mode advertises every other
                mode's prefix, which is more hints than one line holds. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Hint keys={["↑", "↓"]} label="navigate" />
              <Hint keys={["Enter"]} label={enterLabel} />
              {alternateLabel && (
                <Hint keys={["⌘", "Enter"]} label={alternateLabel} />
              )}
              <Hint keys={["Esc"]} label="close" />
              {footerHints}
            </div>
            <span className="shrink-0" aria-live="polite">
              {hasResults &&
                (renderCount
                  ? renderCount(flat.length)
                  : countLabel(flat.length, "result"))}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The app's keycap chip. Shared so palette rows and hints cannot drift. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-surface-raised px-1 py-0.5 text-fg-muted">
      {children}
    </kbd>
  );
}

function Hint({ keys, label }: PaletteHint) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      <span className="ml-0.5">{label}</span>
    </span>
  );
}

/**
 * Selection index, clamped to the current result count and reset whenever the
 * query changes.
 *
 * Resetting on the *query* rather than on the results array matters for async
 * sources: the results array identity changes each time a response lands,
 * which would otherwise yank the cursor back to the top mid-navigation.
 */
function useSelection(
  count: number,
  resetKey: string,
): [number, (update: number | ((prev: number) => number)) => void] {
  const [index, setIndex] = useState(0);
  const previousKey = useRef(resetKey);

  if (previousKey.current !== resetKey) {
    previousKey.current = resetKey;
    if (index !== 0) setIndex(0);
  }

  const last = Math.max(0, count - 1);
  const clamped = Math.min(index, last);

  const set = useCallback(
    (update: number | ((prev: number) => number)) => {
      setIndex((prev) => {
        const from = Math.min(prev, Math.max(0, count - 1));
        const next = typeof update === "function" ? update(from) : update;
        return Math.max(0, Math.min(next, Math.max(0, count - 1)));
      });
    },
    [count],
  );

  return [clamped, set];
}
