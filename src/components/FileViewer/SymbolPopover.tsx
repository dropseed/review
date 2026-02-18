import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { SymbolDefinition, SymbolKind } from "../../types";
import type { SymbolReferenceInDiff } from "../../utils/findSymbolReferencesInDiff";

interface SymbolPopoverProps {
  open: boolean;
  position: { x: number; y: number };
  symbolName: string;
  definitions: SymbolDefinition[];
  references: SymbolReferenceInDiff[];
  loading: boolean;
  onClose: () => void;
  onNavigateToDefinition: (def: SymbolDefinition) => void;
  onNavigateToReference: (ref: SymbolReferenceInDiff) => void;
}

const KIND_LABELS: Record<SymbolKind, string> = {
  function: "fn",
  class: "class",
  struct: "struct",
  trait: "trait",
  impl: "impl",
  method: "method",
  enum: "enum",
  interface: "iface",
  module: "mod",
  type: "type",
};

const KIND_COLORS: Record<SymbolKind, string> = {
  function: "bg-status-renamed/20 text-status-renamed",
  class: "bg-status-modified/20 text-status-modified",
  struct: "bg-status-approved/20 text-status-approved",
  trait: "bg-guide/20 text-guide",
  impl: "bg-fg-muted/20 text-fg-muted",
  method: "bg-status-renamed/20 text-status-renamed",
  enum: "bg-orange-500/20 text-orange-400",
  interface: "bg-guide/20 text-guide",
  module: "bg-fg-muted/20 text-fg-secondary",
  type: "bg-status-trusted/20 text-status-trusted",
};

function SymbolKindBadge({ kind }: { kind: SymbolKind }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${KIND_COLORS[kind] ?? "bg-fg-muted/20 text-fg-muted"}`}
    >
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return path;
  return "…/" + parts.slice(-2).join("/");
}

export function SymbolPopover({
  open,
  position,
  symbolName,
  definitions,
  references,
  loading,
  onClose,
  onNavigateToDefinition,
  onNavigateToReference,
}: SymbolPopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLButtonElement[]>([]);
  const focusedIndexRef = useRef(-1);

  // Reset focus index when popover opens/content changes
  useEffect(() => {
    focusedIndexRef.current = -1;
    itemsRef.current = [];
  }, [open, definitions, references]);

  const collectRef = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      if (el) itemsRef.current[index] = el;
    },
    [],
  );

  // Keyboard navigation + click-outside
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const items = itemsRef.current.filter(Boolean);
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusedIndexRef.current = Math.min(
          focusedIndexRef.current + 1,
          items.length - 1,
        );
        items[focusedIndexRef.current]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusedIndexRef.current = Math.max(focusedIndexRef.current - 1, 0);
        items[focusedIndexRef.current]?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (
        contentRef.current &&
        !contentRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Use capture so we detect clicks before they reach other handlers
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Reference items start after definition items for keyboard navigation indexing
  const refIndexOffset = definitions.length;

  // Position the panel near the click, clamped to the viewport.
  // If there isn't enough room below, flip above the click point.
  const panelWidth = 320; // w-80 = 20rem = 320px
  const panelMaxHeight = 320; // max-h-80 = 20rem = 320px
  const gap = 8;
  const left = Math.min(position.x, window.innerWidth - panelWidth - gap);
  const spaceBelow = window.innerHeight - position.y - gap;
  const top =
    spaceBelow >= panelMaxHeight
      ? position.y + gap
      : Math.max(gap, position.y - panelMaxHeight - gap);

  return createPortal(
    <div
      ref={contentRef}
      style={{ position: "fixed", left, top, zIndex: 50 }}
      className="w-80 max-h-80 overflow-auto rounded-lg border border-edge-default/50 bg-surface-panel/95 backdrop-blur-xl shadow-xl shadow-black/40 outline-hidden animate-in fade-in-0 zoom-in-95"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-edge/50 px-3 py-2">
        <code className="text-sm font-medium text-fg-secondary">
          {symbolName}
        </code>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-5 w-5 rounded-full border-2 border-edge-default border-t-status-modified animate-spin" />
        </div>
      ) : (
        <>
          {/* Definitions section */}
          <div className="px-3 pt-2 pb-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1">
              Definition
            </div>
            {definitions.length === 0 ? (
              <div className="text-xs text-fg-faint py-1">
                No definition found
              </div>
            ) : (
              definitions.map((def, i) => (
                <button
                  key={`def-${i}`}
                  ref={collectRef(i)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-raised/60 focus:bg-surface-raised/60 focus:outline-none transition-colors"
                  onClick={() => onNavigateToDefinition(def)}
                >
                  <SymbolKindBadge kind={def.kind} />
                  <span className="truncate text-fg-secondary font-mono">
                    {truncatePath(def.filePath)}
                  </span>
                  <span className="ml-auto shrink-0 text-fg-muted">
                    :{def.startLine}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* References section */}
          <div className="border-t border-edge/50 px-3 pt-2 pb-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1">
              References in diff
            </div>
            {references.length === 0 ? (
              <div className="text-xs text-fg-faint py-1">
                No references in diff
              </div>
            ) : (
              references.map((ref, i) => (
                <button
                  key={`ref-${i}`}
                  ref={collectRef(refIndexOffset + i)}
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-raised/60 focus:bg-surface-raised/60 focus:outline-none transition-colors"
                  onClick={() => onNavigateToReference(ref)}
                >
                  <span className="truncate text-fg-muted font-mono shrink-0">
                    {truncatePath(ref.filePath)}
                    <span className="text-fg-muted">:{ref.lineNumber}</span>
                  </span>
                  <span className="truncate text-fg-faint font-mono">
                    {ref.lineContent.trim()}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
