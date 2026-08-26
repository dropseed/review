import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./dialog";

/**
 * A sheet of verbs, up from the bottom edge.
 *
 * The phone's answer to a right-click menu. It is not a dropdown: a menu
 * anchored to a control in a strip at the *top* of a 844pt screen puts every
 * one of its rows out of thumb reach, and a popover sized for a mouse gives
 * each of them 24px of height. This gives them 44 and puts them where the hand
 * already is.
 *
 * It is this app's own `DialogContent` with two things said differently — the
 * overlay lays its child out against the bottom edge rather than the middle,
 * and the panel arrives by sliding rather than appearing. Everything else a
 * modal needs (the portal, the focus trap, Escape, the scrim's
 * click-to-dismiss, and holding the element mounted for its exit animation) is
 * the dialog's, which is the point: a sheet is a dialog that comes up from the
 * bottom, not a second modal implementation.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Named for a screen reader; also the sheet's own small caption. */
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="items-end"
        className="w-full max-w-md rounded-t-2xl border-0 border-t border-edge-default/70
                   bg-surface-overlay p-2 shadow-black/60 duration-300
                   data-[state=closed]:slide-out-to-bottom-[100%]
                   data-[state=open]:slide-in-from-bottom-[100%]
                   pb-[max(var(--safe-bottom),0.5rem)]"
      >
        {/* The grabber every sheet on the platform wears. Decoration, and
            honest about it: this one is dismissed by the scrim or by picking
            something, not by dragging. */}
        <div
          aria-hidden="true"
          className="mx-auto mb-1 h-1 w-9 rounded-full bg-fg/20"
        />
        <DialogTitle className="px-3 py-1 text-[13px] font-normal text-fg-faint">
          {title}
        </DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * One verb: a full-width, 44pt row.
 *
 * `trailing` is what a row can carry on its right — a value, or the two
 * steppers a "Text size" row is made of. A row with a trailing control is not
 * itself tappable, since the tap it would swallow belongs to the control.
 *
 * A row that acts closes the sheet, and says so structurally rather than by
 * every caller remembering to: picking something is the end of a sheet, so the
 * button is the dialog's own `Close`.
 */
export function ActionSheetRow({
  label,
  detail,
  danger = false,
  trailing,
  onSelect,
}: {
  label: string;
  detail?: string;
  danger?: boolean;
  trailing?: ReactNode;
  onSelect?: () => void;
}): ReactNode {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {detail != null && (
        <span className="shrink-0 text-[15px] text-fg-faint tabular-nums">
          {detail}
        </span>
      )}
      {trailing}
    </>
  );

  const shape = cn(
    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-[17px]",
    danger ? "text-status-rejected" : "text-fg-secondary",
  );

  if (!onSelect) {
    return <div className={shape}>{body}</div>;
  }

  return (
    <DialogClose asChild>
      <button
        type="button"
        onClick={onSelect}
        className={cn("tap", shape, "active:bg-surface-raised")}
      >
        {body}
      </button>
    </DialogClose>
  );
}
