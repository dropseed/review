import { useEffect, useMemo, useRef } from "react";
import { useReviewStore } from "../stores";
import type { ReviewStore } from "../stores/types";
import type { DiffHunk } from "../types";
import { hunkIdBelongsToFile } from "../types";
import {
  scrollToTarget,
  findLineInShadowDOM,
  NAV_SCROLL_SUPPRESS_MS,
  type ScrollHandle,
} from "../utils/scroll-to-target";
import { suppressScrollForNav } from "./scrollState";

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
  /** The scrollable container (overflow: auto) that owns the diff content */
  scrollContainer: HTMLElement | null;
  /** File rendered in this container (used to detect stale same-file targets) */
  filePath: string;
  /** Hunks actually rendered in this container */
  hunks: DiffHunk[];
  /** Line height in px, for approximate scroll positioning */
  lineHeight: number;
  /** New-side line count, for proportion-based positioning */
  totalLines: number;
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
 * Consume `scrollTarget` (type "hunk") for a single-file diff container.
 * Finds the hunk's annotation panel (`[data-hunk-id]`, light DOM) or falls
 * back to the hunk's first line inside the shadow DOM, and scrolls to it via
 * scrollToTarget (which handles virtualized content and height settling).
 */
export function useHunkScrollTarget({
  scrollContainer,
  filePath,
  hunks,
  lineHeight,
  totalLines,
  pane,
  enabled = true,
}: HunkScrollTargetOptions): void {
  const depsRef = useRef({ filePath, hunks, lineHeight, totalLines, pane });
  depsRef.current = { filePath, hunks, lineHeight, totalLines, pane };
  const handleRef = useRef<ScrollHandle | null>(null);

  // Re-attempt consumption when the rendered hunks change — a target set
  // before the file content loaded becomes claimable once hunks arrive.
  const hunksKey = useMemo(() => hunks.map((h) => h.id).join(","), [hunks]);

  useHunkTargetConsumer(
    scrollContainer !== null && enabled,
    hunksKey,
    function tryConsume(): void {
      const state = useReviewStore.getState();
      const target = state.scrollTarget;
      if (!target || target.type !== "hunk") return;

      const { filePath, hunks, lineHeight, totalLines, pane } = depsRef.current;
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

      state.clearScrollTarget();
      const lineNumber = Math.max(1, hunk.newStart);
      handleRef.current?.cancel();
      handleRef.current = scrollToTarget({
        scrollContainer: scrollContainer!,
        findTarget: () => {
          const panel = scrollContainer!.querySelector(
            `[data-hunk-id="${CSS.escape(hunk.id)}"]`,
          ) as HTMLElement | null;
          // A panel can exist in the light DOM with zero height while its
          // region is virtualized out — don't let it shadow the line fallback.
          if (panel && panel.getBoundingClientRect().height > 0) return panel;
          return findLineInShadowDOM(scrollContainer!, lineNumber) ?? panel;
        },
        lineNumber,
        lineHeight,
        totalLines,
        debugLabel: hunk.id,
      });
    },
  );

  // Cancel any in-flight scroll when the container goes away.
  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
      handleRef.current = null;
    };
  }, [scrollContainer]);
}

/**
 * Scroll a highlighted line (in-file search, go-to-line, symbol jump) into
 * view. Works for both diff and plain-code shadow DOM content.
 */
export function useLineHighlightScroll(
  scrollContainer: HTMLElement | null,
  highlightLine: number | null,
  lineHeight: number,
  totalLines: number,
): void {
  useEffect(() => {
    if (!highlightLine || !scrollContainer) return;

    const handle = scrollToTarget({
      scrollContainer,
      findTarget: () => findLineInShadowDOM(scrollContainer, highlightLine),
      lineNumber: highlightLine,
      lineHeight,
      totalLines,
      debugLabel: `line:${highlightLine}`,
    });

    return () => handle.cancel();
  }, [scrollContainer, highlightLine, lineHeight, totalLines]);
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
