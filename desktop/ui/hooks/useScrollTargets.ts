import { useEffect, useMemo, useRef } from "react";
import { useReviewStore } from "../stores";
import type { ReviewStore } from "../stores/types";
import type { DiffHunk } from "../types";
import { hunkIdBelongsToFile } from "../types";
import { getLastChangedLine } from "../components/FileViewer/hunkUtils";
import type { FileCodeViewHandle } from "../components/FileViewer/FileCodeView";
import { suppressScrollForNav, NAV_SCROLL_SUPPRESS_MS } from "./scrollState";

/**
 * Scroll-target consumption is owned by the component that owns the scroll
 * container, not by the diff renderers inside it. Each scrollable diff
 * surface mounts one of these controllers; a `scrollTarget` in the store is
 * only consumed (and cleared) by the controller whose container actually
 * renders the target hunk. This replaces the old model where every mounted
 * DiffView raced to consume the global target — and the loser's scroll was
 * silently dropped.
 */

/**
 * Run `consume` whenever a hunk scrollTarget may be claimable: on mount,
 * when `contentKey` changes (content loaded/changed), and when a new hunk
 * target lands in the store. Deferred a frame so React commits renders from
 * the same store update before the consumer queries the DOM.
 */
function useHunkTargetConsumer(
  active: boolean,
  contentKey: string | undefined,
  consume: () => void,
): void {
  const consumeRef = useRef(consume);
  consumeRef.current = consume;

  useEffect(() => {
    if (!active) return;

    let raf = requestAnimationFrame(() => consumeRef.current());

    const unsubscribe = useReviewStore.subscribe((state, prevState) => {
      if (
        state.scrollTarget !== prevState.scrollTarget &&
        state.scrollTarget?.type === "hunk"
      ) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => consumeRef.current());
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [active, contentKey]);
}

interface HunkScrollTargetOptions {
  /** Scroll API of the CodeView rendering this file (ref so it can be late-bound) */
  handleRef: React.RefObject<FileCodeViewHandle | null>;
  /** File rendered in this container (used to detect stale same-file targets) */
  filePath: string;
  /** Hunks actually rendered in this container */
  hunks: DiffHunk[];
  /** Which split pane this container is, when split view is possible */
  pane?: "primary" | "secondary";
  /** Whether the container is ready to scroll (content loaded and rendered) */
  enabled?: boolean;
}

/**
 * In split view both panes can render the same file; the focused pane wins.
 * Otherwise a pane claims any target its file renders.
 */
function paneAllowsClaim(
  state: ReviewStore,
  pane: "primary" | "secondary" | undefined,
  filePath: string,
): boolean {
  if (!pane || state.secondaryFile === null) return true;
  const otherPaneFile =
    pane === "primary" ? state.secondaryFile : state.selectedFile;
  return otherPaneFile !== filePath || state.focusedPane === pane;
}

/**
 * Consume `scrollTarget` (type "hunk") for a single-file CodeView container.
 * Scrolls to the hunk's last changed line — the line its annotation panel is
 * attached to — via CodeView's scrollTo, which computes exact offsets from
 * measured layout (no approximation or polling needed).
 */
export function useHunkScrollTarget({
  handleRef,
  filePath,
  hunks,
  pane,
  enabled = true,
}: HunkScrollTargetOptions): void {
  const depsRef = useRef({ filePath, hunks, pane });
  depsRef.current = { filePath, hunks, pane };

  // Re-attempt consumption when the rendered hunks change — a target set
  // before the file content loaded becomes claimable once hunks arrive.
  const hunksKey = useMemo(() => hunks.map((h) => h.id).join(","), [hunks]);

  useHunkTargetConsumer(enabled, hunksKey, function tryConsume(): void {
    const state = useReviewStore.getState();
    const target = state.scrollTarget;
    if (!target || target.type !== "hunk") return;

    const { filePath, hunks, pane } = depsRef.current;
    const hunk = hunks.find((h) => h.id === target.hunkId);

    if (!hunk) {
      // The target names this file but the rendered hunks don't include it
      // (stale ID after a re-diff, or a different diff base). Consume it
      // with a warning so it can't fire somewhere unexpected later.
      if (
        hunkIdBelongsToFile(target.hunkId, filePath) &&
        paneAllowsClaim(state, pane, filePath)
      ) {
        console.warn(
          "[useHunkScrollTarget] target hunk not in rendered file, dropping",
          { hunkId: target.hunkId, filePath },
        );
        state.clearScrollTarget();
      }
      return;
    }

    if (!paneAllowsClaim(state, pane, filePath)) return;

    // Consumers run a frame after commit, so a rendered CodeView has bound
    // its handle by now. A persistently missing handle means this file is
    // showing a non-code mode (image, markdown preview) — consume the
    // target so it can't fire somewhere unexpected later.
    const handle = handleRef.current;
    if (!handle) {
      console.warn(
        "[useHunkScrollTarget] no scrollable code view for target, dropping",
        { hunkId: target.hunkId, filePath },
      );
      state.clearScrollTarget();
      return;
    }

    state.clearScrollTarget();
    // Target the line the hunk's annotation panel hangs off so both the
    // change and its review panel land in view.
    const { lineNumber, side } = getLastChangedLine(hunk);
    suppressScrollForNav(NAV_SCROLL_SUPPRESS_MS);
    handle.scrollToLine(Math.max(1, lineNumber), {
      side: side === "old" ? "deletions" : "additions",
    });
  });
}

/**
 * Scroll a highlighted line (in-file search, go-to-line, symbol jump) into
 * view. Works for both diff and plain-code CodeView items.
 */
export function useLineHighlightScroll(
  handleRef: React.RefObject<FileCodeViewHandle | null>,
  highlightLine: number | null,
  enabled = true,
  /**
   * The code view's scroll container. Included as a dep so a highlight set
   * while a non-code mode was showing (markdown preview, rendered SVG)
   * scrolls once the user toggles to code view and the CodeView mounts.
   */
  containerNode?: HTMLElement | null,
): void {
  useEffect(() => {
    if (!highlightLine || !enabled) return;
    const handle = handleRef.current;
    if (!handle) return;
    suppressScrollForNav(NAV_SCROLL_SUPPRESS_MS);
    handle.scrollToLine(highlightLine);
  }, [handleRef, highlightLine, enabled, containerNode]);
}

/**
 * Consume `scrollTarget` (type "hunk") for a multi-hunk-block surface
 * (GroupDiffViewer). Blocks are light-DOM wrappers tagged with
 * `data-hunk-ids` (newline-separated source hunk IDs), so the target can be
 * scrolled to directly — block wrappers always have layout (virtualized
 * content renders as fixed-height placeholders), no polling needed.
 */
export function useHunkBlockScrollTarget(
  root: HTMLElement | null,
  /** All hunk IDs rendered by this surface (claim check) */
  renderedHunkIds: string[],
  /** Changes when block content loads, to re-attempt deferred targets */
  contentKey?: string,
): void {
  const idsRef = useRef(renderedHunkIds);
  idsRef.current = renderedHunkIds;

  const idsKey = useMemo(() => renderedHunkIds.join(","), [renderedHunkIds]);

  useHunkTargetConsumer(
    root !== null,
    `${idsKey}|${contentKey ?? ""}`,
    function tryConsume(): void {
      const state = useReviewStore.getState();
      const target = state.scrollTarget;
      if (!target || target.type !== "hunk") return;
      if (!idsRef.current.includes(target.hunkId)) return;

      const blocks = root!.querySelectorAll<HTMLElement>("[data-hunk-ids]");
      for (const block of blocks) {
        const ids = (block.dataset.hunkIds ?? "").split("\n");
        if (ids.includes(target.hunkId)) {
          state.clearScrollTarget();
          suppressScrollForNav(NAV_SCROLL_SUPPRESS_MS);
          block.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
      // Claimable but block not in DOM yet (file content still loading) —
      // leave the target; the contentKey change re-attempts when it arrives.
    },
  );
}
