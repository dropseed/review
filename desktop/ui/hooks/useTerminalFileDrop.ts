import { useEffect } from "react";
import { getApiClient, isTauriEnvironment } from "../api";
import { getPlatformServices } from "../platform";
import { toast } from "sonner";
import {
  draggedPane,
  edgeForPoint,
  setDraggedPane,
  setPaneDropTarget,
  subscribePaneDrag,
} from "../components/Terminal/pane-drag";
import type { DropEdge } from "../components/Terminal/pane-tree";
import { useReviewStore } from "../stores";

/**
 * Convert a drag-drop position to CSS pixels within the webview.
 *
 * Tauri types this position as physical, but only some platforms make it so.
 * On macOS wry reads it from AppKit — `NSDraggingInfo.draggingLocation` against
 * the web view's `frame` — and AppKit coordinates are points, i.e. already CSS
 * pixels; tauri-runtime-wry then wraps the number in a `PhysicalPosition`
 * without scaling it. Windows uses `ScreenToClient`, which really is device
 * pixels. Dividing unconditionally therefore halved every coordinate on a
 * Retina display, which is what put drops in the wrong pane.
 *
 * The origin is the web view's own top-left on both, so no title-bar offset is
 * involved: AppKit's window base coordinate system starts at the bottom-left
 * corner, which the title bar (drawn at the top) does not move, and the web
 * view fills the content view either way.
 */
function toCssPixels(
  position: { x: number; y: number },
  scaled: boolean,
): { x: number; y: number } {
  const ratio = scaled ? window.devicePixelRatio || 1 : 1;
  return { x: position.x / ratio, y: position.y / ratio };
}

/** A pane the cursor is over, and where in it — see `paneAt`. */
interface PaneHit {
  el: HTMLElement;
  rect: DOMRect;
  x: number;
  y: number;
}

/**
 * Dropping files onto a terminal pane types their paths at the prompt, the way
 * Ghostty/iTerm2 do — the usual way to hand an image or a log file to a CLI
 * (Claude Code included).
 *
 * Tauri owns the webview's drag-and-drop, so HTML drop events never fire; the
 * paths arrive on the window-level `onDragDropEvent` with a physical cursor
 * position instead. We hit-test that position against the mounted panes
 * (`data-terminal-id`) to decide which PTY receives them. In web mode the
 * browser refuses to expose filesystem paths at all, so this is Tauri-only.
 *
 * A pane dragged by its grip is swallowed the same way — it arrives here with
 * no paths rather than as the `drop` its own handler in PaneTree is waiting for
 * — so pane-onto-pane rearranging is routed through this channel as well, and a
 * drag with neither paths nor a pane behind it is the one that has nothing to
 * give a terminal. The app's other pane drags (onto the tab strip, or a tab onto
 * a sidebar row) are still HTML5-only and therefore web-mode-only; nothing here
 * covers them yet.
 */
export function useTerminalFileDrop(): void {
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const scaled = getPlatformServices().window.getPlatformName() !== "macos";
    let unlisten: (() => void) | null = null;
    let disposed = false;
    let hovered: HTMLElement | null = null;
    /** Pane rects, measured once per drag — see `paneAt`. */
    let panes: { el: HTMLElement; rect: DOMRect }[] = [];
    /**
     * Whether this drag has been measured yet. Tracked rather than read off
     * `panes.length`, which cannot tell "not measured" from "measured, and
     * there are no panes" — the second is the ordinary state with the terminal
     * panel closed, and it would re-scan the document on every pointer move.
     */
    let measured = false;

    // The highlight is toggled imperatively rather than through the store:
    // `over` fires on every pointer move during a drag, and re-rendering the
    // pane tree at that rate would stutter the terminals underneath.
    const setHovered = (el: HTMLElement | null) => {
      if (hovered === el) return;
      hovered?.classList.remove("terminal-drop-target");
      el?.classList.add("terminal-drop-target");
      hovered = el;
    };

    const measurePanes = () => {
      panes = [
        ...document.querySelectorAll<HTMLElement>("[data-terminal-id]"),
      ].map((el) => ({ el, rect: el.getBoundingClientRect() }));
      measured = true;
    };

    const forgetPanes = () => {
      panes = [];
      measured = false;
    };

    // A drag that begins inside the webview — a pane picked up by its grip — is
    // already over a pane and never announces itself with an `enter`, so its
    // rects are taken when the grip is picked up. The subscription also fires
    // for the drop target, which moves constantly; only the pickup measures.
    let carriedByGrip: string | null = null;
    const unsubDrag = subscribePaneDrag(() => {
      const dragging = draggedPane();
      if (dragging && !carriedByGrip) measurePanes();
      carriedByGrip = dragging;
    });

    /**
     * The pane under the cursor, with the box it was hit against and the cursor
     * in CSS pixels — a dragged pane lands in whichever half of the target it
     * was released over, so where in the pane matters as well as which one.
     *
     * Hit-tested against rects measured when the drag entered rather than via
     * `elementFromPoint`, which would force a style+layout recalc on every
     * pointer move — and the terminal underneath is dirtying the DOM
     * continuously while it streams. Panes can't move mid-drag, so one
     * measurement per drag is enough.
     */
    const paneAt = (position: { x: number; y: number }): PaneHit | null => {
      const { x, y } = toCssPixels(position, scaled);
      const hit = panes.find(
        ({ rect }) =>
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom,
      );
      return hit ? { ...hit, x, y } : null;
    };

    /** Where a pane released at `hit` would land, or null if nowhere. */
    const dropTargetAt = (
      hit: PaneHit | null,
      source: string,
    ): { paneId: string; edge: DropEdge } | null => {
      const paneId = hit?.el.dataset.terminalId;
      // A pane dropped on itself changes nothing, and neither does one dropped
      // outside every pane.
      if (!hit || !paneId || paneId === source) return null;
      return { paneId, edge: edgeForPoint(hit.rect, hit.x, hit.y) };
    };

    /**
     * The pane being carried, latched from the drag events rather than read at
     * the drop: the page's own `dragend` fires as soon as the pointer is
     * released and clears it, and this event still has a trip through Tauri's
     * IPC ahead of it.
     */
    let carried: string | null = null;

    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      if (disposed) return;
      void getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") {
            setHovered(null);
            setPaneDropTarget(null);
            carried = null;
            forgetPanes();
            return;
          }
          if (payload.type === "enter") {
            carried = null;
            // Panes can't move mid-drag, but they can have moved since the last
            // one — a new drag measures again.
            forgetPanes();
          }
          if (payload.type === "enter" || payload.type === "over") {
            if (!measured) measurePanes();
            const hit = paneAt(payload.position);
            carried ??= draggedPane();
            if (carried) {
              // A pane in flight shows the half it would fill, not the
              // whole-pane outline a file drop gets.
              setPaneDropTarget(dropTargetAt(hit, carried));
              return;
            }
            setHovered(hit?.el ?? null);
            return;
          }
          // drop
          const hit = paneAt(payload.position);
          setHovered(null);
          setPaneDropTarget(null);
          forgetPanes();
          if (carried) {
            const target = dropTargetAt(hit, carried);
            const source = carried;
            carried = null;
            setDraggedPane(null);
            if (target) {
              useReviewStore
                .getState()
                .dropPaneOn(source, target.paneId, target.edge);
            }
            return;
          }
          const terminalId = hit?.el.dataset.terminalId;
          if (!terminalId) return;
          if (payload.paths.length === 0) {
            // A drag with no filesystem path — an image dragged out of a
            // browser, say. Nothing to type at a prompt, but silence here reads
            // as the drop having been lost.
            toast.error("Only files can be dropped into a terminal");
            return;
          }
          const text = payload.paths.map(quoteShellPath).join(" ") + " ";
          getApiClient()
            .terminalWrite(terminalId, text)
            .catch((err) => {
              console.error("[terminal] Drop write failed:", err);
              toast.error("Failed to insert dropped path");
            });
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        });
    });

    return () => {
      disposed = true;
      setHovered(null);
      unsubDrag();
      unlisten?.();
    };
  }, []);
}

/**
 * Quote a path for the shell the way a terminal's own drag-and-drop does:
 * leave ordinary paths untouched, single-quote anything with a space or other
 * character the shell would act on.
 */
export function quoteShellPath(path: string): string {
  if (/^[A-Za-z0-9_@%+=:,.\/-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
