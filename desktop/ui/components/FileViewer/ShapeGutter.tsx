import { memo, useEffect, useMemo, useState, type JSX } from "react";
import { useReviewStore } from "../../stores";
import type { ShapeRow } from "./shape-model";

interface ShapeGutterProps {
  /** One entry per line of the synthesized document. */
  rows: readonly ShapeRow[];
  /** Row height in px — the same value fed to pierre's `itemMetrics`. */
  lineHeight: number;
  /** pierre's scroll container (CodeView owns scrolling). */
  scrollNode: HTMLDivElement | null;
  onToggleFold: (foldId: string) => void;
}

/** How many rows to draw beyond the viewport so a fast scroll never tears. */
const OVERSCAN = 4;

/**
 * The real line numbers for shape mode.
 *
 * pierre numbers whatever document it is handed 1..N, and in shape mode that
 * document is synthesized — its numbering would claim the file has no gaps,
 * when the gaps *are* the elision signal. So pierre's own numbers are turned
 * off (`disableLineNumbers`) and this column draws the real ones instead.
 *
 * It is a sibling of the scroll container, not an overlay inside it: rows are
 * uniform height, so a row's y is `index * lineHeight - scrollTop` and the
 * visible slice is a pure function of scrollTop and clientHeight. Only that
 * slice is rendered, so this stays O(viewport) like pierre's own virtualizer.
 */
export const ShapeGutter = memo(function ShapeGutter({
  rows,
  lineHeight,
  scrollNode,
  onToggleFold,
}: ShapeGutterProps): JSX.Element {
  const codeFontSize = useReviewStore((s) => s.codeFontSize);
  const codeFontFamily = useReviewStore((s) => s.codeFontFamily);

  const [scroll, setScroll] = useState({ top: 0, height: 0 });

  useEffect(() => {
    if (!scrollNode) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setScroll((prev) =>
        prev.top === scrollNode.scrollTop &&
        prev.height === scrollNode.clientHeight
          ? prev
          : { top: scrollNode.scrollTop, height: scrollNode.clientHeight },
      );
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    scrollNode.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scrollNode);
    read();
    return () => {
      scrollNode.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [scrollNode]);

  const digits = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const line = row.kind === "code" ? row.line : row.endLine;
      return String(line).length;
    }
    return 2;
  }, [rows]);

  const first = Math.max(0, Math.floor(scroll.top / lineHeight) - OVERSCAN);
  const last = Math.min(
    rows.length - 1,
    Math.ceil((scroll.top + scroll.height) / lineHeight) + OVERSCAN,
  );

  const visible: JSX.Element[] = [];
  for (let i = first; i <= last; i++) {
    const row = rows[i];
    if (!row) continue;
    const top = i * lineHeight - scroll.top;
    const foldId: string | undefined = row.foldId;

    visible.push(
      <div
        key={i}
        className="absolute right-0 flex w-full items-center justify-end gap-1 pr-2 tabular-nums select-none"
        style={{ top, height: lineHeight, lineHeight: `${lineHeight}px` }}
      >
        {foldId ? (
          <button
            type="button"
            onClick={() => onToggleFold(foldId)}
            title={
              row.kind === "marker"
                ? `Expand ${row.foldName} (${row.hiddenLines} lines)`
                : `Collapse ${row.foldName ?? "body"}`
            }
            aria-label={
              row.kind === "marker"
                ? `Expand ${row.foldName}`
                : `Collapse ${row.foldName ?? "body"}`
            }
            aria-expanded={row.kind !== "marker"}
            className="pointer-events-auto flex h-full w-3 shrink-0 items-center justify-center text-fg-faint transition-colors hover:text-fg-secondary"
          >
            <svg
              className={`h-2.5 w-2.5 transition-transform ${
                row.kind === "marker" ? "" : "rotate-90"
              }`}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M9 5l7 7-7 7z" />
            </svg>
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden="true" />
        )}
        <span
          className={
            row.kind === "marker" ? "text-fg-faint/50" : "text-fg-faint"
          }
        >
          {row.kind === "marker" ? "" : row.line}
        </span>
      </div>,
    );
  }

  return (
    <div
      className="pointer-events-none relative h-full shrink-0 overflow-hidden border-r border-edge/40 bg-surface-panel"
      style={{
        width: `calc(${digits}ch + 1.75rem)`,
        fontSize: codeFontSize,
        fontFamily: codeFontFamily,
      }}
    >
      {visible}
    </div>
  );
});
