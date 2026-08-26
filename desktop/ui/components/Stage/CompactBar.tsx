import type { ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { useTerminalDockPresent } from "../../stores/selectors/terminals";
import { compactStageHalf } from "./compact";

/**
 * The phone's stage switch: which half of this workspace is on screen.
 *
 * Two destinations, not three. The workspace queue is *not* here — it is a
 * hamburger on the half headers (`Stage/CompactNav`), because leaving the
 * workspace is a different kind of move from switching between two views of the
 * one you are in. A row of three made them look like siblings and reduced the
 * app's whole navigation to a third pane.
 *
 * At desktop width neither control exists: the halves are side by side with a
 * hover-revealed toggle, and there is no hover at 390px to reveal one with.
 * This drives the same `contentFocus` that toggle drives, so nothing here is a
 * mode of its own — widening the window puts it back exactly as it was.
 *
 * With no terminal half there is nothing to switch *to*, and a bar holding one
 * lit tab is a label pretending to be a control — so it doesn't render at all.
 */
export function CompactBar(): ReactNode {
  const contentFocus = useReviewStore((s) => s.contentFocus);
  const setContentFocus = useReviewStore((s) => s.setContentFocus);
  const terminalOverview = useReviewStore((s) => s.terminalOverview);
  const setTerminalOverview = useReviewStore((s) => s.setTerminalOverview);
  const docked = useTerminalDockPresent();
  const half = compactStageHalf(contentFocus, docked);

  if (!docked) return null;

  // The overview replaces both halves, so while it is up neither tab is the
  // thing on screen — tapping one has to put the stage back first.
  function show(next: "terminal" | "code"): void {
    if (terminalOverview) setTerminalOverview(false);
    setContentFocus(next);
  }

  return (
    <nav
      // No inset padding of its own: the shell pays for the home indicator once
      // (`router.tsx`), in the same `bg-surface` this bar is drawn in, so the
      // bar's own background reads as continuing under the indicator — and the
      // bottom edge stays clear even in the layouts where this bar isn't the
      // thing on it.
      className="flex shrink-0 items-stretch gap-1 border-t border-t-edge/40
                 bg-surface px-2 py-1 md:hidden"
      aria-label="Stage"
    >
      <BarButton
        onClick={() => show("terminal")}
        label="Terminal"
        current={!terminalOverview && half === "terminal"}
      >
        <TerminalGlyph />
      </BarButton>

      <BarButton
        onClick={() => show("code")}
        label="Code"
        current={!terminalOverview && half === "code"}
      >
        <CodeGlyph />
      </BarButton>
    </nav>
  );
}

/**
 * One target. Sized by the bar rather than by its glyph — a row on a phone is
 * thumb-sized areas, so the 48px minimum is the floor and not the aspiration.
 */
function BarButton({
  onClick,
  label,
  current,
  children,
}: {
  onClick: () => void;
  label: string;
  current: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={clsx(
        // `tap` is the press state — dim and shrink the instant a finger lands,
        // ease back over 150ms. On a tab bar that is the whole of the feedback:
        // there is no hover here, and a tab that only changes once the view has
        // switched leaves the tap looking unheard. See index.css.
        `tap flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5
         rounded-lg text-[11px] font-medium`,
        current
          ? "bg-surface-raised text-fg-secondary"
          : "text-fg-muted active:bg-surface-raised/60",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function TerminalGlyph(): ReactNode {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 17l6-5-6-5" />
      <path d="M12 19h8" />
    </svg>
  );
}

function CodeGlyph(): ReactNode {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 18l4-6-4-6" />
      <path d="M8 6l-4 6 4 6" />
    </svg>
  );
}
