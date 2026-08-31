import { useCallback, useRef, useState } from "react";
import { useSpurStore } from "../../stores";
import { useOverlay, useCloseOverlay } from "../../stores/selectors/overlay";
import { PaletteDialog, Kbd, type PaletteSource } from "./PaletteDialog";
import { PALETTE_MODES, readModeSwitch, type PaletteMode } from "./modes";
import { useCommandSource } from "./sources/commands";
import { useGoSource } from "./sources/go";
import { useFileSource } from "./sources/files";
import { useSymbolSource } from "./sources/symbols";
import { useContentSource } from "./sources/content";

/**
 * Mounted always, rendered only when open, so the hooks below cost nothing
 * while the palette is closed.
 */
export function Palette() {
  const open = useOverlay("palette");
  if (!open) return null;
  return <OpenPalette />;
}

/**
 * The five search surfaces behind one dialog.
 *
 * Modes swap the *contents* of a dialog that stays mounted, rather than each
 * being its own dialog. Four Radix roots would mean unmounting one and mounting
 * another on every prefix keystroke, replaying the open animation and dropping
 * focus mid-type.
 *
 * The cost of one mounted dialog is that every mode's hook runs on every
 * render, since hooks cannot be called conditionally. Each takes `active` and
 * declines its own work — the fetches and the tree walks are all behind it.
 */
function OpenPalette() {
  const closePalette = useCloseOverlay("palette");
  const openingMode = useSpurStore((s) => s.paletteMode);
  const lastSearch = useSpurStore((s) => s.searchQuery);

  const [mode, setMode] = useState<PaletteMode>(openingMode);
  const [query, setQuery] = useState(() => queryFor(openingMode, lastSearch));
  // Read once. Threading the live query in would re-run the dialog's focus
  // effect on every keystroke, reselecting the text as the user typed.
  const [selectOnOpen] = useState(() => query !== "");
  // Where Backspace on an empty query goes. Bounded by the modes actually
  // visited this session, so it cannot walk somewhere the user has not been.
  const history = useRef<PaletteMode[]>([]);

  const go = useGoSource(query, mode === "go");
  const commands = useCommandSource(query, mode === "commands");
  const files = useFileSource(query, mode === "files");
  const symbols = useSymbolSource(query, mode === "symbols");
  const content = useContentSource(query, mode === "content");

  // Erased one at a time rather than after the lookup: a union of differently
  // parameterized sources has no common supertype TypeScript will accept, but
  // each branch on its own checks against the source it was built from.
  const source = {
    go: eraseSource(go),
    commands: eraseSource(commands),
    files: eraseSource(files),
    symbols: eraseSource(symbols),
    content: eraseSource(content),
  }[mode];

  const handleQueryChange = useCallback(
    (next: string) => {
      const switched = readModeSwitch(query, next, mode);
      if (switched === null) {
        setQuery(next);
        return;
      }
      // Pushed here rather than inside a `setMode` updater: React may call an
      // updater twice, which would record the mode twice and make one
      // Backspace look like two.
      history.current.push(mode);
      setMode(switched);
      setQuery(queryFor(switched, lastSearch));
    },
    [lastSearch, mode, query],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Backspace on an empty query steps back a mode rather than doing
      // nothing. This is also the only way back out of a mode entered by
      // mistake — a leading `@` is a prefix, so it cannot simply be deleted.
      //
      // With nothing to unwind it falls to go, which is otherwise
      // unreachable: go is the mode with no prefix, so opening straight
      // into another one (⌘P, ⌘R) would strand the user there with no
      // keystroke that leads out.
      if (event.key === "Backspace" && query === "") {
        const previous = history.current.pop() ?? (mode === "go" ? null : "go");
        if (previous === null) return false;
        event.preventDefault();
        setMode(previous);
        setQuery(queryFor(previous, lastSearch));
        return true;
      }
      return source.onKeyDown?.(event) ?? false;
    },
    [lastSearch, mode, query, source],
  );

  return (
    <PaletteDialog<unknown>
      {...source}
      open
      onClose={closePalette}
      query={query}
      onQueryChange={handleQueryChange}
      onKeyDown={handleKeyDown}
      selectOnOpen={selectOnOpen}
      // A mode switch can leave the query untouched — ⌘K then `@` is empty
      // either side — while replacing every row, so the mode has to be part of
      // what the selection resets on or the cursor stays where it was in a
      // list that no longer exists.
      resetSelectionOn={`${mode}\n${query}`}
      inputPrefix={<ModeChip mode={mode} />}
      // Only while the box is empty — that is when the user is deciding what
      // to do, and once they are typing the hints are three more things
      // competing with the results.
      footerHints={query === "" ? <PrefixHints mode={mode} /> : null}
    />
  );
}

/**
 * The query a mode is entered with.
 *
 * Content search resumes where it was left; the rest start empty. A grep is a
 * thing you refine, and its results are also what the sidebar's results panel
 * is showing — arriving with an empty box would clear both, so passing through
 * content mode would throw away a search the user never touched.
 */
function queryFor(mode: PaletteMode, lastSearch: string): string {
  return mode === "content" ? lastSearch : "";
}

/**
 * Erase a source's item type so one dialog can render any mode.
 *
 * The modes produce genuinely different rows, and TypeScript has no way to say
 * "some T, consistently" for a value — every field of a `PaletteSource<T>`
 * agrees on `T` at the point it is built, which is what actually matters, and
 * the dialog only ever passes items back to the callbacks they came with.
 */
function eraseSource<T>(source: PaletteSource<T>): PaletteSource<unknown> {
  return source as PaletteSource<unknown>;
}

function ModeChip({ mode }: { mode: PaletteMode }) {
  return (
    <span
      data-palette-mode={mode}
      className="flex-shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-xs text-fg-secondary"
    >
      {PALETTE_MODES[mode].label}
    </span>
  );
}

/**
 * The prefixes for the modes you are not in.
 *
 * Listing them is the only discovery path — a prefix is invisible until you
 * happen to type it, which is the standing complaint about this pattern.
 */
function PrefixHints({ mode }: { mode: PaletteMode }) {
  const others = (Object.keys(PALETTE_MODES) as PaletteMode[]).filter(
    (id) => id !== mode && PALETTE_MODES[id].prefix !== null,
  );
  return (
    <>
      {others.map((id) => (
        <span key={id} className="flex items-center gap-1">
          <Kbd>{PALETTE_MODES[id].prefix}</Kbd>
          <span className="ml-0.5">
            {PALETTE_MODES[id].label.toLowerCase()}
          </span>
        </span>
      ))}
      {/* Go has no prefix to advertise, so the way back is named instead —
          otherwise the one mode you cannot type your way to is also the one
          the footer never mentions. */}
      {mode !== "go" && (
        <span className="flex items-center gap-1">
          <Kbd>⌫</Kbd>
          <span className="ml-0.5">back</span>
        </span>
      )}
    </>
  );
}
