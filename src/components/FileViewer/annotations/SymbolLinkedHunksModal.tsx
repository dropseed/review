import { useState, useMemo } from "react";
import type { DiffHunk, HunkState } from "../../../types";
import type { SymbolLinkedHunk } from "../../../utils/symbolLinkedHunks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../../ui/dialog";
import { SimpleTooltip } from "../../ui/tooltip";
import { HunkPreview } from "./HunkPreview";

interface SymbolLinkedHunksModalProps {
  /** The current hunk being viewed */
  currentHunk: DiffHunk;
  /** Symbol-linked hunks with connection info */
  symbolLinks: SymbolLinkedHunk[];
  /** Lookup from hunk ID to hunk object */
  hunkById: Map<string, DiffHunk>;
  /** Hunk states for showing approval status */
  hunkStates: Record<string, HunkState | undefined>;
  /** Callback to approve all linked hunks */
  onApproveAll: (hunkIds: string[]) => void;
  /** Callback to reject all linked hunks */
  onRejectAll: (hunkIds: string[]) => void;
  /** Callback when user wants to navigate to a specific hunk */
  onNavigateToHunk?: (hunkId: string) => void;
}

/** Group symbol links by symbol name and determine this hunk's role */
interface SymbolGroup {
  symbolName: string;
  /** This hunk's role: "modifies" means it defines/changes the symbol, "uses" means it references it */
  thisHunkRole: "modifies" | "uses";
  /** Linked hunks for this symbol */
  linkedHunks: { entry: SymbolLinkedHunk; hunk: DiffHunk }[];
}

/**
 * Check if a reference hunk is a "pure" reference update — i.e., every added line
 * in the hunk is accounted for by a symbol reference. This means the hunk only
 * changed because of the symbol modification, with no unrelated changes mixed in.
 */
function isPureReference(
  hunk: DiffHunk,
  referenceLineNumbers: number[],
): boolean {
  if (referenceLineNumbers.length === 0) return false;

  const refLines = new Set(referenceLineNumbers);
  const addedLines = hunk.lines.filter((l) => l.type === "added");

  // Must have at least one added line to be a meaningful change
  if (addedLines.length === 0) return false;

  // Every added line must have a symbol reference on it
  return addedLines.every(
    (l) => l.newLineNumber !== undefined && refLines.has(l.newLineNumber),
  );
}

function groupBySymbol(
  symbolLinks: SymbolLinkedHunk[],
  hunkById: Map<string, DiffHunk>,
): SymbolGroup[] {
  const bySymbol = new Map<
    string,
    { entries: SymbolLinkedHunk[]; hunks: DiffHunk[] }
  >();

  for (const link of symbolLinks) {
    const hunk = hunkById.get(link.hunkId);
    if (!hunk) continue;
    const existing = bySymbol.get(link.symbolName) ?? {
      entries: [],
      hunks: [],
    };
    existing.entries.push(link);
    existing.hunks.push(hunk);
    bySymbol.set(link.symbolName, existing);
  }

  const groups: SymbolGroup[] = [];
  for (const [symbolName, { entries, hunks }] of bySymbol) {
    // relationship describes what the OTHER hunk does:
    // "references" → other hunk references it → THIS hunk modifies/defines it
    // "defines" → other hunk defines it → THIS hunk uses/references it
    const thisHunkRole =
      entries[0].relationship === "references" ? "modifies" : "uses";

    groups.push({
      symbolName,
      thisHunkRole,
      linkedHunks: entries.map((entry, i) => ({ entry, hunk: hunks[i] })),
    });
  }

  // Sort: "modifies" first (more important), then by linked hunk count
  groups.sort((a, b) => {
    if (a.thisHunkRole !== b.thisHunkRole) {
      return a.thisHunkRole === "modifies" ? -1 : 1;
    }
    return b.linkedHunks.length - a.linkedHunks.length;
  });

  return groups;
}

/**
 * Symbol-linked hunks annotation.
 *
 * Two modes based on this hunk's role:
 * - **Leaf** (uses modified symbols): single chip that navigates directly
 *   to the definition hunk ("go to definition").
 * - **Parent** (modifies symbols referenced elsewhere): chip opens a modal
 *   showing all reference hunks. Batch approve/reject only for "pure reference"
 *   hunks where every changed line is a symbol reference update.
 *
 * Always shows one primary symbol chip. Additional symbols collapse into "+N".
 */
export function SymbolLinkedHunksModal({
  currentHunk,
  symbolLinks,
  hunkById,
  hunkStates,
  onApproveAll,
  onRejectAll,
  onNavigateToHunk,
}: SymbolLinkedHunksModalProps) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(
    () => groupBySymbol(symbolLinks, hunkById),
    [symbolLinks, hunkById],
  );

  if (groups.length === 0) {
    return null;
  }

  const primary = groups[0];
  const additionalCount = groups.length - 1;

  // Determine if this hunk is purely a leaf (only "uses" symbols, no "modifies")
  const isLeaf = groups.every((g) => g.thisHunkRole === "uses");

  // For leaf hunks: navigate to the first definition hunk on click
  if (isLeaf && onNavigateToHunk) {
    // Find the definition hunk to navigate to (first linked hunk of primary symbol)
    const defHunk = primary.linkedHunks[0]?.hunk;
    if (!defHunk) return null;

    return (
      <SimpleTooltip
        content={`${primary.symbolName} was modified in ${defHunk.filePath} — click to go to definition${additionalCount > 0 ? ` (+${additionalCount} more symbol${additionalCount === 1 ? "" : "s"})` : ""}`}
      >
        <button
          onClick={() => onNavigateToHunk(defHunk.id)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xxs text-status-renamed/80 transition-colors hover:bg-surface-hover/50 hover:text-status-renamed"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
            />
          </svg>
          <code className="font-mono">{primary.symbolName}</code>
          {additionalCount > 0 && (
            <span className="text-fg-faint">+{additionalCount}</span>
          )}
        </button>
      </SimpleTooltip>
    );
  }

  // Parent hunk: show chip that opens modal with all reference hunks
  const allLinkedHunks = groups.flatMap((g) => g.linkedHunks);

  // Identify which reference hunks are "pure" (only symbol reference changes)
  const pureRefHunkIds = new Set<string>();
  for (const { entry, hunk } of allLinkedHunks) {
    if (
      entry.relationship === "references" &&
      isPureReference(hunk, entry.referenceLineNumbers)
    ) {
      pureRefHunkIds.add(hunk.id);
    }
  }

  // Batch actions only apply to pure-reference hunks + the current definition hunk
  const batchHunkIds = [
    currentHunk.id,
    ...allLinkedHunks
      .filter((r) => pureRefHunkIds.has(r.hunk.id))
      .map((r) => r.hunk.id),
  ];
  const hasPureRefs = pureRefHunkIds.size > 0;

  const handleApproveAll = () => {
    onApproveAll(batchHunkIds);
    setOpen(false);
  };

  const handleRejectAll = () => {
    onRejectAll(batchHunkIds);
    setOpen(false);
  };

  const totalRefs = groups
    .filter((g) => g.thisHunkRole === "modifies")
    .reduce((sum, g) => sum + g.linkedHunks.length, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Single chip trigger */}
      <SimpleTooltip
        content={`This hunk modifies ${primary.symbolName} — ${totalRefs} hunk${totalRefs === 1 ? "" : "s"} reference${totalRefs === 1 ? "s" : ""} it${additionalCount > 0 ? ` (+${additionalCount} more symbol${additionalCount === 1 ? "" : "s"})` : ""}`}
      >
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xxs text-status-modified/80 transition-colors hover:bg-surface-hover/50 hover:text-status-modified"
        >
          <code className="font-mono">{primary.symbolName}</code>
          <span className="text-fg-faint">({totalRefs})</span>
          {additionalCount > 0 && (
            <span className="text-fg-faint">+{additionalCount}</span>
          )}
        </button>
      </SimpleTooltip>

      <DialogContent
        className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg"
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Symbol Connections</span>
            <span className="rounded-full bg-surface-hover/50 px-2 py-0.5 text-xs font-normal text-fg-muted tabular-nums">
              {groups.length} symbol{groups.length === 1 ? "" : "s"}
            </span>
          </DialogTitle>
          <DialogClose className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg-secondary transition-colors">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </DialogClose>
        </DialogHeader>

        {/* Scrollable list grouped by symbol */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {groups.map((group) => (
            <div key={group.symbolName}>
              {/* Symbol header */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xxs font-medium ${
                    group.thisHunkRole === "modifies"
                      ? "bg-status-modified/15 text-status-modified"
                      : "bg-status-renamed/15 text-status-renamed"
                  }`}
                >
                  {group.thisHunkRole === "modifies"
                    ? "This hunk modifies"
                    : "This hunk uses"}
                </span>
                <code className="text-xs font-mono text-fg-secondary">
                  {group.symbolName}
                </code>
                <span className="text-xxs text-fg-faint">
                  {group.linkedHunks.length} connected hunk
                  {group.linkedHunks.length === 1 ? "" : "s"}
                </span>
              </div>

              {/* Linked hunks for this symbol */}
              <div className="space-y-2 pl-2 border-l border-edge">
                {group.linkedHunks.map(({ entry, hunk }) => {
                  const isPure = pureRefHunkIds.has(hunk.id);
                  const status = hunkStates[hunk.id]?.status;
                  return (
                    <div key={hunk.id} className="group relative">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xxs text-fg-muted">
                          {entry.relationship === "defines"
                            ? "Defines"
                            : "References"}{" "}
                          in{" "}
                          <span className="text-fg-muted">{hunk.filePath}</span>
                        </span>
                        {isPure && (
                          <span className="rounded bg-status-approved/10 px-1 py-0.5 text-xxs text-status-approved/80">
                            pure ref
                          </span>
                        )}
                        {status && (
                          <span
                            className={`rounded px-1 py-0.5 text-xxs ${
                              status === "approved"
                                ? "bg-status-approved/10 text-status-approved"
                                : "bg-status-rejected/10 text-status-rejected"
                            }`}
                          >
                            {status}
                          </span>
                        )}
                      </div>
                      <div
                        className="cursor-pointer"
                        onClick={() => onNavigateToHunk?.(hunk.id)}
                      >
                        <HunkPreview
                          hunk={hunk}
                          hunkState={hunkStates[hunk.id]}
                        />
                      </div>
                      {onNavigateToHunk && (
                        <button
                          className="absolute top-2 right-2 rounded bg-surface-hover/80 px-2 py-1 text-xxs text-fg-secondary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-active"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToHunk(hunk.id);
                            setOpen(false);
                          }}
                        >
                          Go to hunk
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Action footer — only shown when there are pure-reference hunks */}
        {hasPureRefs && (
          <div className="flex items-center justify-between border-t border-edge px-4 py-3 bg-surface-panel/50">
            <div className="text-xs text-fg-muted">
              {pureRefHunkIds.size} pure reference hunk
              {pureRefHunkIds.size === 1 ? "" : "s"} + this definition
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRejectAll}
                className="flex items-center gap-1.5 rounded-md bg-status-rejected/15 px-3 py-1.5 text-sm font-medium text-status-rejected transition-colors hover:bg-status-rejected/25 active:scale-[0.98]"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                Reject All
              </button>
              <button
                onClick={handleApproveAll}
                className="flex items-center gap-1.5 rounded-md bg-status-approved/20 px-3 py-1.5 text-sm font-medium text-status-approved transition-colors hover:bg-status-approved/30 active:scale-[0.98]"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Approve All
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
