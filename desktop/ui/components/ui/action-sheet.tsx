import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { clsx } from "clsx";

/**
 * A sheet of verbs, up from the bottom edge.
 *
 * The phone's answer to a right-click menu. It is not a dropdown: a menu
 * anchored to a control in a strip at the *top* of a 844pt screen puts every
 * one of its rows out of thumb reach, and a popover sized for a mouse gives
 * each of them 24px of height. This gives them 44 and puts them where the hand
 * already is.
 *
 * Radix's Dialog underneath, for the parts that are not the drawing: the focus
 * trap, Escape, the scrim's click-to-dismiss, and holding the element mounted
 * long enough for its exit animation to run.
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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50
                     data-[state=closed]:animate-out data-[state=open]:animate-in
                     data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Content
            aria-modal="true"
            className="w-full max-w-md rounded-t-2xl border-t border-edge-default/70
                       bg-surface-overlay p-2 shadow-2xl shadow-black/60 duration-300
                       data-[state=closed]:animate-out data-[state=open]:animate-in
                       data-[state=closed]:slide-out-to-bottom-[100%]
                       data-[state=open]:slide-in-from-bottom-[100%]
                       pb-[max(var(--safe-bottom),0.5rem)]"
          >
            {/* The grabber every sheet on the platform wears. Decoration, and
                honest about it: this one is dismissed by the scrim or by
                picking something, not by dragging. */}
            <div
              aria-hidden="true"
              className="mx-auto mb-1 h-1 w-9 rounded-full bg-fg/20"
            />
            <DialogPrimitive.Title className="px-3 py-1 text-[13px] text-fg-faint">
              {title}
            </DialogPrimitive.Title>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * One verb: a full-width, 44pt row.
 *
 * `trailing` is what a row can carry on its right — a value, or the two
 * steppers a "Text size" row is made of. A row with a trailing control is not
 * itself tappable, since the tap it would swallow belongs to the control.
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

  const shape = clsx(
    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-[17px]",
    danger ? "text-status-rejected" : "text-fg-secondary",
  );

  if (!onSelect) {
    return <div className={shape}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx("tap", shape, "active:bg-surface-raised")}
    >
      {body}
    </button>
  );
}

/** A hairline between groups of rows. */
export function ActionSheetSeparator(): ReactNode {
  return <div className="my-1 h-px bg-edge" aria-hidden="true" />;
}
