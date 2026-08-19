import { useEffect } from "react";
import { getApiClient, isTauriEnvironment } from "../api";
import { getPlatformServices } from "../platform";
import { toast } from "sonner";
import {
  draggedPane,
  draggedTabSource,
  draggedTerminal,
  edgeForPoint,
  setDraggedPane,
  setDraggedTab,
  setDraggedTerminal,
  setPaneDropTarget,
  setTabDropTarget,
  subscribePaneDrag,
  type TabDragSource,
} from "../components/Terminal/pane-drag";
import {
  expandedLeafIds,
  type DropEdge,
} from "../components/Terminal/pane-tree";
import { useReviewStore } from "../stores";
import {
  findTabForTerminal,
  tabSessionIds,
} from "../stores/slices/terminalSlice";
import {
  applyWorkDrop,
  draggedWorkspace,
  forgetWorkTargets,
  sessionsOfTab,
  setDraggedWorkspace,
  setWorkDropTarget,
  workDragPayload,
  workDropTargetAt,
  type WorkspaceDrag,
} from "../components/Sidebar/workspace-drag";

/**
 * Convert a drag-drop position to CSS pixels within the page's viewport.
 *
 * Tauri types this position as physical, but only some platforms make it so.
 * On macOS wry reads it from AppKit — `NSDraggingInfo.draggingLocation` against
 * the web view's `frame` — and AppKit coordinates are points, i.e. already CSS
 * pixels; tauri-runtime-wry then wraps the number in a `PhysicalPosition`
 * without scaling it. Windows uses `ScreenToClient`, which really is device
 * pixels. Dividing unconditionally therefore halved every coordinate on a
 * Retina display, which is what put drops in the wrong pane.
 *
 * `insetY` corrects the other macOS lie: wry y-flips `draggingLocation`
 * against the web view NSView's own frame height, but that NSView underlaps
 * the title bar (the window reports inner == outer size) while the page's
 * viewport starts below it. Both coordinate systems share the *bottom* edge,
 * so the flip against the taller height lands every y one title bar too low —
 * measured at ~32px, which put the highlight a full row under the cursor. The
 * inset is measured (`measureDragInsetY`) rather than assumed, so wherever
 * view and viewport agree — fullscreen, other platforms — it is zero and this
 * is a no-op. It cannot detect wry fixing its flip upstream (tauri#10744 is
 * the class), since the heights it compares don't change with that: when
 * bumping wry past 0.56, re-test a drag before trusting this correction.
 */
function toCssPixels(
  position: { x: number; y: number },
  scaled: boolean,
  insetY: number,
): { x: number; y: number } {
  const ratio = scaled ? window.devicePixelRatio || 1 : 1;
  return { x: position.x / ratio, y: position.y / ratio - insetY };
}

/**
 * The height difference between the native view drag positions are measured
 * in and the page viewport — see `toCssPixels`. Async because the window size
 * lives across the IPC; callers keep the last measurement.
 */
async function measureDragInsetY(): Promise<number> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const [inner, factor] = await Promise.all([w.innerSize(), w.scaleFactor()]);
  return Math.max(0, Math.round(inner.height / factor - window.innerHeight));
}

/**
 * How long the strip-and-sidebar rects are trusted before being re-measured.
 *
 * Those drop targets are hit-tested against cached `getBoundingClientRect`s
 * rather than `elementFromPoint`, which would force a style+layout recalc on
 * every pointer move while the terminals underneath dirty the DOM
 * continuously. But the sidebar is not frozen mid-drag — it can scroll, and
 * its rows pop in as their statuses stream in — and rects measured once at
 * pickup drift away from what is on screen, putting the highlight and the
 * drop on the wrong row. Re-measuring on a throttle keeps both honest at a
 * few recalcs per second instead of one per move. The pane rects are not
 * throttled: panes can't move mid-drag, so they keep their one-measure cache.
 */
const REMEASURE_MS = 150;

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
 * The app's own drags are swallowed the same way — a pane dragged by its grip
 * or a tab dragged off the strip arrives here with no paths rather than as the
 * `drop` its HTML5 handlers are waiting for. So every in-app drop target is
 * hit-tested from this channel too: pane-onto-pane rearranging, a pane onto a
 * strip tab or the extract-to-new-tab slot, a tab onto another strip position
 * (reorder), and any of the three onto a work card. A drag with neither paths
 * nor a pane/tab/row behind it is the one that has nothing to give a terminal.
 *
 * Mounted at the app shell, because "Working on" is one of those targets and
 * the sidebar is always on screen. Everything here is measured from the live
 * DOM per drag, so with the terminal panel closed the pane and strip halves
 * simply find nothing while the work-card half keeps working.
 */
export function useTerminalFileDrop(): void {
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const scaled = getPlatformServices().window.getPlatformName() !== "macos";

    // The title-bar inset drag positions arrive shifted by — see
    // `toCssPixels`. Measured up front and on resize (which fullscreen also
    // fires, where the inset drops to zero) rather than mid-drag: the value
    // only changes with window chrome, never under the cursor.
    let insetY = 0;
    const refreshInsetY = () => {
      measureDragInsetY().then(
        (v) => (insetY = v),
        () => {},
      );
    };
    refreshInsetY();
    window.addEventListener("resize", refreshInsetY);
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

    /**
     * The strip's drop targets, measured separately from the panes: picking a
     * pane up is what makes the extract slot appear (and can rewrap the
     * strip), so these rects are only trustworthy after React has committed
     * that render — i.e. on the first event *after* the pickup, not at the
     * pickup itself.
     */
    let stripTabs: {
      rect: DOMRect;
      tabId: string;
      index: number;
      leaves: string[];
    }[] = [];
    let newTabSlot: DOMRect | null = null;
    let stripMeasuredAt: number | null = null;

    const stale = (at: number | null): boolean =>
      at === null || performance.now() - at > REMEASURE_MS;

    const inRect = (rect: DOMRect, x: number, y: number): boolean =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

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

    const measureStrip = () => {
      stripTabs = [
        ...document.querySelectorAll<HTMLElement>("[data-strip-tab]"),
      ].map((el) => ({
        rect: el.getBoundingClientRect(),
        tabId: el.dataset.stripTab ?? "",
        index: Number(el.dataset.stripIndex),
        leaves: (el.dataset.stripLeaves ?? "").split(" ").filter(Boolean),
      }));
      newTabSlot =
        document
          .querySelector<HTMLElement>("[data-strip-new-tab]")
          ?.getBoundingClientRect() ?? null;
      stripMeasuredAt = performance.now();
    };

    const forgetStrip = () => {
      stripTabs = [];
      newTabSlot = null;
      stripMeasuredAt = null;
    };

    // A drag that begins inside the webview — a pane picked up by its grip, a
    // tab off the strip, or a sidebar terminal row — is already over the page
    // and never announces itself with an `enter`, so the pickup is what resets
    // the caches; the first `over` measures, after React has committed the
    // pickup's own render (the extract slot appearing can rewrap the strip).
    // The subscription also fires for the drop target, which moves constantly;
    // only the pickup resets.
    let carriedByGrip: string | null = null;
    const unsubDrag = subscribePaneDrag(() => {
      const dragging =
        draggedPane() ?? draggedTabSource()?.tabId ?? draggedTerminal();
      if (dragging && !carriedByGrip) {
        forgetPanes();
        forgetStrip();
      }
      carriedByGrip = dragging;
    });

    /**
     * The pane under the cursor, with the box it was hit against and the cursor
     * in CSS pixels — a dragged pane lands in whichever half of the target it
     * was released over, so where in the pane matters as well as which one.
     *
     * Hit-tested against rects measured once per drag rather than via
     * `elementFromPoint`, which would force a style+layout recalc on every
     * pointer move — and the terminal underneath is dirtying the DOM
     * continuously while it streams. Panes can't move mid-drag, so one
     * measurement per drag is enough.
     */
    const paneAt = ({ x, y }: { x: number; y: number }): PaneHit | null => {
      const hit = panes.find(({ rect }) => inRect(rect, x, y));
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
     * The pane / tab being carried, latched from the drag events rather than
     * read at the drop: the page's own `dragend` fires as soon as the pointer
     * is released and clears the module state, and this event still has a trip
     * through Tauri's IPC ahead of it.
     */
    let carried: string | null = null;
    let carriedTab: TabDragSource | null = null;
    let carriedTerminal: string | null = null;
    let carriedWorkspace: WorkspaceDrag | null = null;

    /** Forget every drag this handler can be carrying. */
    const dropCarried = () => {
      carried = null;
      carriedTab = null;
      carriedTerminal = null;
      carriedWorkspace = null;
      setWorkDropTarget(null);
      forgetWorkTargets();
    };

    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      if (disposed) return;
      void getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") {
            setHovered(null);
            setPaneDropTarget(null);
            setTabDropTarget(null);
            dropCarried();
            forgetPanes();
            forgetStrip();
            return;
          }
          if (payload.type === "enter") {
            dropCarried();
            // Panes can't move mid-drag, but they can have moved since the last
            // one — a new drag measures again.
            forgetPanes();
            forgetStrip();
          }
          if (payload.type === "enter" || payload.type === "over") {
            if (!measured) measurePanes();
            carried ??= draggedPane();
            carriedTab ??= draggedTabSource();
            carriedTerminal ??= draggedTerminal();
            carriedWorkspace ??= draggedWorkspace();
            if (
              (carried || carriedTab || carriedTerminal) &&
              stale(stripMeasuredAt)
            ) {
              measureStrip();
            }
            const pt = toCssPixels(payload.position, scaled, insetY);
            if (carriedWorkspace) {
              // A queue entry in flight: only the queue takes it, so nothing
              // else needs hit-testing — and a reorder can only land in a gap.
              setWorkDropTarget(workDropTargetAt(pt.x, pt.y, true));
              return;
            }
            if (carriedTerminal) {
              // A sidebar terminal row in flight: only a work card takes it.
              setWorkDropTarget(workDropTargetAt(pt.x, pt.y, false));
              setTabDropTarget(null);
              return;
            }
            if (carriedTab) {
              // A tab in flight: a work card claims it first — attaching a
              // terminal to what it's for outranks moving it in the strip.
              const work = workDropTargetAt(pt.x, pt.y, false);
              setWorkDropTarget(work);
              if (work) {
                setTabDropTarget(null);
                return;
              }
              const tabHit = stripTabs.find((t) => inRect(t.rect, pt.x, pt.y));
              if (tabHit && tabHit.index !== carriedTab.index) {
                setTabDropTarget({ kind: "tab-reorder", index: tabHit.index });
                return;
              }
              setTabDropTarget(null);
              return;
            }
            if (carried) {
              // A pane in flight: a work card takes it the same way it takes a
              // tab or a sidebar row — a pane is a session, and the sidebar is
              // where a session gets claimed.
              const work = workDropTargetAt(pt.x, pt.y, false);
              setWorkDropTarget(work);
              if (work) {
                setPaneDropTarget(null);
                setTabDropTarget(null);
                return;
              }
              // The strip's targets don't overlap the panes, so the order below
              // is just cheap-lists-first.
              const tabHit = stripTabs.find((t) => inRect(t.rect, pt.x, pt.y));
              if (tabHit && !tabHit.leaves.includes(carried)) {
                setPaneDropTarget(null);
                setTabDropTarget({
                  kind: "pane-into-tab",
                  tabId: tabHit.tabId,
                });
                return;
              }
              if (newTabSlot && inRect(newTabSlot, pt.x, pt.y)) {
                setPaneDropTarget(null);
                setTabDropTarget({ kind: "new-tab" });
                return;
              }
              setTabDropTarget(null);
              // A pane over another pane shows the half it would fill, not the
              // whole-pane outline a file drop gets.
              setPaneDropTarget(dropTargetAt(paneAt(pt), carried));
              return;
            }
            setHovered(paneAt(pt)?.el ?? null);
            return;
          }
          // drop — the strip resolves against the rects the visible highlight
          // used, even if they have aged past the throttle: re-measuring here
          // could land the drop somewhere other than the row shown lit.
          if (!measured) measurePanes();
          if (
            (carried || carriedTab || carriedTerminal) &&
            stripMeasuredAt === null
          ) {
            measureStrip();
          }
          const pt = toCssPixels(payload.position, scaled, insetY);
          const hit = paneAt(pt);
          setHovered(null);
          setPaneDropTarget(null);
          setTabDropTarget(null);
          forgetPanes();
          // Resolved before the target is cleared, so the drop lands where the
          // highlight said it would. Every grip that carries a terminal asks —
          // a row, a pane, a tab — since "Working on" takes all three.
          const workTarget =
            carriedWorkspace || carriedTerminal || carried || carriedTab
              ? workDropTargetAt(pt.x, pt.y, carriedWorkspace !== null)
              : null;
          setWorkDropTarget(null);
          forgetWorkTargets();
          if (carriedWorkspace) {
            const payload = workDragPayload(carriedWorkspace, []);
            carriedWorkspace = null;
            setDraggedWorkspace(null);
            forgetStrip();
            if (workTarget && payload) void applyWorkDrop(workTarget, payload);
            return;
          }
          if (carriedTerminal) {
            const terminalId = carriedTerminal;
            carriedTerminal = null;
            setDraggedTerminal(null);
            forgetStrip();
            if (workTarget) {
              void applyWorkDrop(workTarget, {
                kind: "terminal",
                sessionIds: tabSessionIds(
                  useReviewStore.getState().terminalTabs,
                  terminalId,
                ),
              });
            }
            return;
          }
          if (carriedTab) {
            const source = carriedTab;
            carriedTab = null;
            setDraggedTab(null);
            if (workTarget) {
              forgetStrip();
              void applyWorkDrop(workTarget, {
                kind: "terminal",
                sessionIds: sessionsOfTab(source.tabId),
              });
              return;
            }
            const tabHit =
              stripTabs.find((t) => inRect(t.rect, pt.x, pt.y)) ?? null;
            forgetStrip();
            if (tabHit && tabHit.index !== source.index) {
              useReviewStore.getState().moveTab(source.index, tabHit.index);
            }
            return;
          }
          if (carried) {
            const source = carried;
            carried = null;
            setDraggedPane(null);
            const state = useReviewStore.getState();
            if (workTarget) {
              forgetStrip();
              // The pane's whole tab, like every other terminal drop: a pane
              // dragged onto a card claims the tab it belongs to.
              void applyWorkDrop(workTarget, {
                kind: "terminal",
                sessionIds: tabSessionIds(state.terminalTabs, source),
              });
              return;
            }
            const tabHit = stripTabs.find((t) => inRect(t.rect, pt.x, pt.y));
            const ontoNewTab =
              newTabSlot !== null && inRect(newTabSlot, pt.x, pt.y);
            forgetStrip();
            if (tabHit && !tabHit.leaves.includes(source)) {
              state.movePaneToTab(source, tabHit.tabId);
              return;
            }
            if (ontoNewTab) {
              state.movePaneToNewTab(source);
              return;
            }
            const target = dropTargetAt(hit, source);
            if (target) {
              state.dropPaneOn(source, target.paneId, target.edge);
            }
            return;
          }
          forgetStrip();
          const terminalId = hit?.el.dataset.terminalId;
          if (!terminalId) return;
          if (payload.paths.length === 0) {
            // A drag with no filesystem path — an image dragged out of a
            // browser, say. Nothing to type at a prompt, but silence here reads
            // as the drop having been lost.
            toast.error("Only files can be dropped into a terminal");
            return;
          }
          // Dropping onto a folded pane's title bar unfolds it: the path is
          // about to be typed at that prompt, and inserting it into a shell the
          // user can't see reads as the drop having gone nowhere. Focusing is
          // what unfolds a pane, so this is the same one call.
          const store = useReviewStore.getState();
          const tab = findTabForTerminal(store.terminalTabs, terminalId);
          if (tab && !expandedLeafIds(tab.root).includes(terminalId)) {
            store.setFocusedTerminalPane(tab.id, terminalId);
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
      window.removeEventListener("resize", refreshInsetY);
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
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
