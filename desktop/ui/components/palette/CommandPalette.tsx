import { useCallback, useState } from "react";
import {
  useOverlay,
  useCloseOverlay,
  useStoreRevision,
} from "../../stores/selectors/overlay";
import { scoreCandidate, indicesFor, HighlightedText } from "../../lib/fuzzy";
import {
  useCommandRegistryVersion,
  getAllCommands,
  resolveCommands,
  buildCommandContext,
  formatShortcut,
} from "../../commands";
import type { ResolvedCommand } from "../../commands";
import {
  PaletteDialog,
  Kbd,
  countLabel,
  type PaletteGroup,
} from "./PaletteDialog";

/** Weights for the fields a command can be found by. */
const TITLE_WEIGHT = 1;
const KEYWORD_WEIGHT = 0.55;
const CATEGORY_WEIGHT = 0.35;

/** Order categories appear in when the query is empty. */
const CATEGORY_ORDER = ["Go", "Review", "View", "Application"];

interface Entry {
  resolved: ResolvedCommand;
  /** Offsets into the command title, when the title is what matched. */
  titleIndices: number[];
}

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/**
 * Mounted always, rendered only when open.
 *
 * The split is what lets the open palette subscribe to the whole store: a
 * command's predicates read arbitrary state, so nothing narrower can know when
 * enablement has changed. Memoizing on `[commands, open]` instead — as this
 * did — froze every predicate at the moment the palette was summoned, leaving
 * a command greyed out and inert after the state that blocked it cleared.
 */
export function CommandPalette() {
  const open = useOverlay("commandPalette");
  if (!open) return null;
  return <OpenCommandPalette />;
}

function OpenCommandPalette() {
  const closePalette = useCloseOverlay("commandPalette");
  const [query, setQuery] = useState("");
  useCommandRegistryVersion();

  // Any store write re-renders this, which is the point — see above. Scoped to
  // the open palette so a closed one costs nothing.
  useStoreRevision();

  const close = useCallback(() => {
    closePalette();
    setQuery("");
  }, [closePalette]);

  const available = resolveCommands(getAllCommands(), buildCommandContext());

  const groups = ((): PaletteGroup<Entry>[] => {
    const trimmed = query.trim();

    if (!trimmed) {
      // No query: group by category so the palette doubles as a map of what
      // the app can do, with runnable commands ahead of inert ones.
      const byCategory = new Map<string, Entry[]>();
      for (const resolved of available) {
        const list = byCategory.get(resolved.command.category) ?? [];
        list.push({ resolved, titleIndices: [] });
        byCategory.set(resolved.command.category, list);
      }
      return [...byCategory.entries()]
        .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
        .map(([category, items]) => ({
          key: category,
          header: <CategoryHeader label={category} />,
          items: items.sort(
            (a, b) => Number(b.resolved.enabled) - Number(a.resolved.enabled),
          ),
        }));
    }

    const scored: { entry: Entry; score: number }[] = [];
    for (const resolved of available) {
      const { command } = resolved;
      const result = scoreCandidate(
        trimmed,
        [
          { key: "title", text: command.title, weight: TITLE_WEIGHT },
          {
            key: "keywords",
            text: command.keywords?.join(" ") ?? "",
            weight: KEYWORD_WEIGHT,
          },
          { key: "category", text: command.category, weight: CATEGORY_WEIGHT },
        ],
        // A command that cannot run right now should still be findable, just
        // never ahead of one that can.
        { boost: resolved.enabled ? 0 : -0.5 },
      );
      if (!result) continue;
      scored.push({
        score: result.score,
        entry: {
          resolved,
          titleIndices: indicesFor(result, "title"),
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return [{ key: "results", items: scored.map((s) => s.entry) }];
  })();

  const handleActivate = useCallback(
    (entry: Entry) => {
      if (!entry.resolved.enabled) return;
      close();
      void entry.resolved.command.run(buildCommandContext());
    },
    [close],
  );

  return (
    <PaletteDialog<Entry>
      open
      onClose={close}
      title="Command Palette"
      query={query}
      onQueryChange={setQuery}
      placeholder="Type a command…"
      groups={groups}
      getKey={(entry) => entry.resolved.command.id}
      renderRow={(entry) => (
        <CommandRow entry={entry} showShortcut={!query.trim()} />
      )}
      onActivate={handleActivate}
      emptyMessage="No matching commands"
      renderCount={(n) => countLabel(n, "command")}
    />
  );
}

function CategoryHeader({ label }: { label: string }) {
  return (
    <div
      data-palette-header
      className="sticky top-0 bg-surface-panel border-b border-edge px-4 py-1 text-xxs uppercase tracking-wide text-fg-faint"
    >
      {label}
    </div>
  );
}

function CommandRow({
  entry,
  showShortcut,
}: {
  entry: Entry;
  showShortcut: boolean;
}) {
  const { command, enabled } = entry.resolved;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 text-left ${
        enabled ? "" : "opacity-40"
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
        <HighlightedText text={command.title} indices={entry.titleIndices} />
      </span>
      {/* Shortcuts are noise while searching — the point of typing is that you
          are not reaching for one. */}
      {showShortcut && command.shortcut && (
        <span className="flex flex-shrink-0 items-center gap-1">
          {formatShortcut(command.shortcut).map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      )}
    </div>
  );
}
