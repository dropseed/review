import { type ReactNode, useEffect } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { Sidebar } from "./index";

/**
 * The queue at phone width: the same sidebar, over the stage instead of beside
 * it.
 *
 * A 15rem column is most of a 390px screen, so on a phone the sidebar stops
 * being chrome and becomes a place you go — opened from the hamburger,
 * dismissed by picking a workspace, tapping the scrim, or Escape. It slides
 * from the left because that is the edge it lives on everywhere else.
 *
 * It stays mounted while closed (translated off-screen, `inert` so nothing in
 * it is tabbable or readable to a screen reader) rather than unmounting: the
 * queue's scroll position and its drawer states are worth keeping across a
 * gesture people will make dozens of times an hour.
 */
export function QueueDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactNode {
  // Picking a workspace is the drawer's exit: `focusWorkspace` changes what the
  // stage shows, and leaving the queue covering it would hide the answer.
  //
  // Keyed on `workspaceSeenAt` rather than on `focusedWorkspaceId`, because the
  // most ordinary gesture here — open the queue to glance at it, tap the card
  // you are already in — changes no id, and the drawer used to just sit there.
  // `focusWorkspace` stamps a fresh timestamp object every time it runs, so this
  // fires on a re-tap as well.
  const focusStamp = useReviewStore((s) => s.workspaceSeenAt);
  useEffect(() => {
    onClose();
  }, [focusStamp, onClose]);

  // Escape closes it — the phone has no ⌘B, and a drawer with a hardware back
  // gesture that does nothing is a trap.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={clsx(
        "fixed inset-0 z-40 md:hidden",
        !open && "pointer-events-none",
      )}
      // `inert` rather than `hidden`: the panel has to keep its layout (and its
      // scroll position) while it is off-screen, but nothing inside it should
      // be reachable by tab or by a screen reader while it is.
      inert={!open}
    >
      <div
        className={clsx(
          "absolute inset-0 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={clsx(
          `absolute inset-y-0 left-0 flex w-[min(20rem,82vw)] flex-col
           bg-surface shadow-2xl transition-transform duration-200 ease-out
           pl-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)]`,
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar drawer onDismiss={onClose} />
      </div>
    </div>
  );
}
