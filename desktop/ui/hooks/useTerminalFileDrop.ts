import { useEffect } from "react";
import { getApiClient, isTauriEnvironment } from "../api";
import { getPlatformServices } from "../platform";
import { toast } from "sonner";

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
    };

    /**
     * The pane under the cursor. Hit-tested against rects measured when the
     * drag entered rather than via `elementFromPoint`, which would force a
     * style+layout recalc on every pointer move — and the terminal underneath
     * is dirtying the DOM continuously while it streams. Panes can't move
     * mid-drag, so one measurement per drag is enough.
     */
    const paneAt = (position: { x: number; y: number }): HTMLElement | null => {
      const { x, y } = toCssPixels(position, scaled);
      return (
        panes.find(
          ({ rect }) =>
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom,
        )?.el ?? null
      );
    };

    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      if (disposed) return;
      void getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") {
            setHovered(null);
            panes = [];
            return;
          }
          if (payload.type === "enter") measurePanes();
          if (payload.type === "enter" || payload.type === "over") {
            setHovered(paneAt(payload.position));
            return;
          }
          // drop
          const pane = paneAt(payload.position);
          setHovered(null);
          panes = [];
          const terminalId = pane?.dataset.terminalId;
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
