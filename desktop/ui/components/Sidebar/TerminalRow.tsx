import { memo, type ReactNode } from "react";
import { clsx } from "clsx";
import { useTabGlance } from "../../stores/selectors/terminals";
import { jumpToTab } from "../Terminal/jump";
import { PhaseDot } from "./PhaseDot";

/**
 * One terminal tab, as a line under the workspace card that holds it.
 *
 * A tab, not a session: panes are the panel's own layout, and a tab that has
 * been split is still one terminal everywhere outside the panel — which is why
 * the pane count is written the way the strip writes it rather than as a second
 * row per pane. What the line answers is "which shells are here, and what is
 * each of them doing", the question the card's single dot could only answer for
 * the loudest one.
 *
 * Its own component, and memoized, because it subscribes to its own tab: the
 * glances are built once and keep per-tab identity (`getTabGlances`), so a
 * status tick re-renders the one line it changed and leaves the rest of the
 * queue — and the card around it — alone. Rendering nothing when the glance is
 * null is the sidebar's membership rule: a tab whose panes the status stream
 * hasn't reported on has no phase and no title, and a row for it would be a
 * blank one.
 */
export const TerminalRow = memo(function TerminalRow({
  tabId,
}: {
  tabId: string;
}): ReactNode {
  const glance = useTabGlance(tabId);
  if (!glance) return null;
  const { severity, allDead, title, leafIds, agent } = glance;

  return (
    // Pointer chrome only: the card is one `role="option"` in the queue's
    // listbox, so a focusable child here would both break that contract and
    // take the arrow keys out of step with the entries they walk. The keyboard
    // route to a terminal is ⌘K, which lists every running one.
    <div
      onClick={(event) => {
        // The card's own click opens the workspace and selects whichever tab it
        // was last on — which is precisely the tab the user just pointed away
        // from.
        event.stopPropagation();
        jumpToTab(tabId);
      }}
      title={title}
      className="flex items-center gap-1.5 rounded px-1 py-px hover:bg-fg/[0.06]"
    >
      <PhaseDot phase={severity ?? "idle"} dead={allDead} agent={agent} />
      <span
        className={clsx(
          "min-w-0 flex-1 truncate text-[10px] leading-4",
          allDead ? "text-fg-faint/50" : "text-fg-faint",
        )}
      >
        {title}
      </span>
      {leafIds.length > 1 && (
        <span className="shrink-0 text-xxs text-fg-faint tabular-nums">
          {leafIds.length}
        </span>
      )}
    </div>
  );
});
