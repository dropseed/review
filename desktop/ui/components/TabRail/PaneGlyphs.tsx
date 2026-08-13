import { type ReactNode } from "react";
import { PhaseDot } from "./PhaseDot";
import { phaseLabel } from "./terminal-status-format";
import type { TabPaneGlance } from "../../stores/selectors/terminals";

/**
 * A tab's status marker in the sidebar: one glyph, or one per pane once the tab
 * has been split.
 *
 * A split tab is still one row — panes are the panel's own layout — but a row
 * that showed only the loudest phase said nothing about the shell beside it,
 * which is exactly the case where a second shell exists to be watched. So the
 * marker grows a glyph per pane rather than the row growing a second line: the
 * cluster carries the count as well as the phases, which is why the rows that
 * use it print no number of their own.
 *
 * `onSelect` makes each glyph the way into that pane. The row's own click
 * already opens the tab at whichever pane it was left on; this is how you land
 * on the other one without going through the panel.
 */
export function PaneGlyphs({
  panes,
  onSelect,
}: {
  panes: TabPaneGlance[];
  onSelect?: (paneId: string) => void;
}): ReactNode {
  // The unsplit case is the common one, and it is the marker every other row in
  // the sidebar carries — no button, no cluster, nothing to explain.
  if (panes.length <= 1) {
    const pane = panes[0];
    return <PhaseDot phase={pane?.phase ?? "idle"} dead={pane?.dead} />;
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {panes.map((pane) => {
        const label = pane.dead
          ? `${pane.title} — exited`
          : `${pane.title} — ${phaseLabel(pane.phase)}`;
        if (!onSelect) {
          return (
            <PhaseDot
              key={pane.id}
              phase={pane.phase}
              dead={pane.dead}
              className="h-2.5 w-2.5"
            />
          );
        }
        return (
          <button
            key={pane.id}
            type="button"
            // The row is itself a click target (and a drag handle), so this has
            // to keep its click to itself.
            onClick={(e) => {
              e.stopPropagation();
              onSelect(pane.id);
            }}
            title={label}
            aria-label={label}
            className="flex items-center"
          >
            <PhaseDot
              phase={pane.phase}
              dead={pane.dead}
              className="h-2.5 w-2.5"
            />
          </button>
        );
      })}
    </span>
  );
}
