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
import type { DropEdge } from "../components/Terminal/pane-tree";
import { useReviewStore } from "../stores";
import { panelReviewKey } from "../stores/slices/terminalSlice";

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
 * (reorder) or a sidebar row (re-home), and a sidebar terminal row onto another
 * row (re-home). A drag with neither paths nor a pane/tab/row behind it is the
 * one that has nothing to give a terminal.
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

    /**
     * The strip-and-sidebar drop targets, measured separately from the panes:
     * picking a pane up is what makes the extract slot appear (and can rewrap
     * the strip), so these rects are only trustworthy after React has
     * committed that render — i.e. on the first event *after* the pickup, not
     * at the pickup itself.
     */
    let stripTabs: {
      rect: DOMRect;
      tabId: string;
      index: number;
      leaves: string[];
    }[] = [];
    let newTabSlot: DOMRect | null = null;
    let homeRows: { rect: DOMRect; reviewKey: string; rowId: string }[] = [];
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
      homeRows = [
        ...document.querySelectorAll<HTMLElement>("[data-tab-home-key]"),
      ].map((el) => ({
        rect: el.getBoundingClientRect(),
        reviewKey: el.dataset.tabHomeKey ?? "",
        rowId: el.dataset.tabHomeRow ?? "",
      }));
      stripMeasuredAt = performance.now();
    };

    const forgetStrip = () => {
      stripTabs = [];
      newTabSlot = null;
      homeRows = [];
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

    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
      if (disposed) return;
      void getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") {
            setHovered(null);
            setPaneDropTarget(null);
            setTabDropTarget(null);
            carried = null;
            carriedTab = null;
            carriedTerminal = null;
            forgetPanes();
            forgetStrip();
            return;
          }
          if (payload.type === "enter") {
            carried = null;
            carriedTab = null;
            carriedTerminal = null;
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
            if (
              (carried || carriedTab || carriedTerminal) &&
              stale(stripMeasuredAt)
            ) {
              measureStrip();
            }
            const pt = toCssPixels(payload.position, scaled);
            if (carriedTerminal) {
              // A sidebar terminal row in flight: only a row can take it, and
              // it has no position in the strip to be reordered into.
              const row = homeRows.find((r) => inRect(r.rect, pt.x, pt.y));
              setTabDropTarget(
                row
                  ? {
                      kind: "tab-home",
                      reviewKey: row.reviewKey,
                      rowId: row.rowId,
                    }
                  : null,
              );
              return;
            }
            if (carriedTab) {
              // A tab in flight: a sidebar row would re-home it, another strip
              // position would reorder it.
              const row = homeRows.find((r) => inRect(r.rect, pt.x, pt.y));
              if (row) {
                setTabDropTarget({
                  kind: "tab-home",
                  reviewKey: row.reviewKey,
                  rowId: row.rowId,
                });
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
              // A pane in flight: the strip's targets don't overlap the panes,
              // so the order here is just cheap-lists-first.
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
          const pt = toCssPixels(payload.position, scaled);
          const hit = paneAt(pt);
          setHovered(null);
          setPaneDropTarget(null);
          setTabDropTarget(null);
          forgetPanes();
          if (carriedTerminal) {
            const terminalId = carriedTerminal;
            carriedTerminal = null;
            setDraggedTerminal(null);
            const row = homeRows.find((r) => inRect(r.rect, pt.x, pt.y));
            forgetStrip();
            if (row) {
              useReviewStore
                .getState()
                .setTerminalHome(terminalId, row.reviewKey);
            }
            return;
          }
          if (carriedTab) {
            const source = carriedTab;
            carriedTab = null;
            setDraggedTab(null);
            const row = homeRows.find((r) => inRect(r.rect, pt.x, pt.y));
            const tabHit = row
              ? null
              : (stripTabs.find((t) => inRect(t.rect, pt.x, pt.y)) ?? null);
            forgetStrip();
            const state = useReviewStore.getState();
            if (row) {
              state.setTabHome(source.tabId, row.reviewKey);
            } else if (tabHit && tabHit.index !== source.index) {
              // Strip positions, not stored ones — the store maps them back
              // and declines a drag the strip's own sort would swallow.
              state.moveTab(source.reviewKey, source.index, tabHit.index);
            }
            return;
          }
          if (carried) {
            const source = carried;
            carried = null;
            setDraggedPane(null);
            const tabHit = stripTabs.find((t) => inRect(t.rect, pt.x, pt.y));
            const ontoNewTab =
              newTabSlot !== null && inRect(newTabSlot, pt.x, pt.y);
            forgetStrip();
            const state = useReviewStore.getState();
            // The tab a pane lands in is the one to be looking at, and the
            // strip may be showing it as a pinned visitor — so activation is
            // said for the key being viewed, not the key that owns the tab.
            const viewedKey = panelReviewKey(
              state.terminalCheckouts,
              state.repoPath ?? "",
              state.reviewRef,
            );
            if (tabHit && !tabHit.leaves.includes(source)) {
              state.movePaneToTab(source, tabHit.tabId);
              state.setActiveTab(viewedKey, tabHit.tabId);
              return;
            }
            if (ontoNewTab) {
              const newTabId = state.movePaneToNewTab(source);
              if (newTabId) state.setActiveTab(viewedKey, newTabId);
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
