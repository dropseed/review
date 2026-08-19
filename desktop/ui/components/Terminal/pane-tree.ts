/**
 * Pure helpers for the terminal pane tree (iTerm/tmux-style splits within a
 * tab). A tab holds one `PaneNode` tree; leaves are terminal sessions, splits
 * arrange their children in a row (side by side) or column (stacked) with
 * fractional `sizes` summing to 1.
 *
 * Everything here is pure and deterministic (no Date/random) so it can be unit
 * tested and driven from store reducers. Id generation lives in the slice
 * actions, never here.
 */

export type SplitDirection = "row" | "column";

/** Which side of a target pane a dragged pane is being dropped against. */
export type DropEdge = "left" | "right" | "top" | "bottom";

export type PaneNode =
  | {
      type: "leaf";
      terminalId: string;
      /**
       * Folded down to a title bar: the session keeps running and keeps its
       * slice of `sizes`, it just isn't drawn. The bar's thickness is fixed, so
       * a collapsed pane is the one child of a split that doesn't flex.
       */
      collapsed?: boolean;
    }
  | {
      type: "split";
      direction: SplitDirection;
      children: PaneNode[];
      sizes: number[];
    };

export interface TerminalTab {
  id: string;
  root: PaneNode;
  /** terminalId of the focused leaf in this tab. */
  focused: string;
}

export function leaf(terminalId: string): PaneNode {
  return { type: "leaf", terminalId };
}

export function makeTab(id: string, terminalId: string): TerminalTab {
  return { id, root: leaf(terminalId), focused: terminalId };
}

/**
 * `tab` re-rooted at `root`, keeping its focus if that pane survived. Null when
 * nothing survived.
 *
 * The one place the "repair the focus" rule is written: closing a pane, moving
 * one to another tab, reconciling against the daemon's session list and
 * rebuilding a stored layout all end up here, so a tab can't pick its next
 * focused pane four different ways.
 */
export function withRepairedFocus(
  tab: Pick<TerminalTab, "id" | "focused">,
  root: PaneNode | null,
): TerminalTab | null {
  if (!root) return null;
  // Repaired against the panes still *drawn*, not merely still present: a
  // folded pane holds no keyboard focus and shows no cursor, so landing focus
  // there leaves the tab with a dimmed terminal and nothing typing into it.
  const showing = expandedLeafIds(root);
  return {
    ...tab,
    root,
    focused: showing.includes(tab.focused)
      ? tab.focused
      : (showing[0] ?? firstLeafId(root)),
  };
}

/** Even fractions for `n` children (sums to 1). */
export function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

/**
 * A split rebuilt around the children that survived, with their sizes.
 *
 * The "a split of one *is* that child, and a split of none is nothing" rule,
 * written once: removals, prunes and the rebuild from storage all fold their
 * trees back up through here.
 */
function rebuildSplit(
  direction: SplitDirection,
  children: PaneNode[],
  sizes: number[],
): PaneNode | null {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { type: "split", direction, children, sizes: normalize(sizes) };
}

/** Renormalize sizes to sum to 1 (guards against drift after removals). */
function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0) return evenSizes(sizes.length);
  return sizes.map((s) => s / total);
}

/** All terminal ids in the tree, left-to-right / top-to-bottom. */
export function collectLeafIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.terminalId];
  return node.children.flatMap(collectLeafIds);
}

/** Terminal ids of the leaves actually showing a terminal, in the same order. */
export function expandedLeafIds(node: PaneNode): string[] {
  if (node.type === "leaf") return node.collapsed ? [] : [node.terminalId];
  return node.children.flatMap(expandedLeafIds);
}

/** Whether anything under `node` is drawn as a terminal rather than a bar. */
export function showsTerminal(node: PaneNode): boolean {
  if (node.type === "leaf") return !node.collapsed;
  return node.children.some(showsTerminal);
}

/**
 * Fold the leaf for `targetId` down to a bar, or unfold it. Returns the
 * original tree when nothing changes, so a reducer can skip the write.
 */
export function setLeafCollapsed(
  node: PaneNode,
  targetId: string,
  collapsed: boolean,
): PaneNode {
  if (node.type === "leaf") {
    if (node.terminalId !== targetId) return node;
    if (!!node.collapsed === collapsed) return node;
    return collapsed ? { ...node, collapsed: true } : leaf(node.terminalId);
  }
  const children = node.children.map((c) =>
    setLeafCollapsed(c, targetId, collapsed),
  );
  return children.every((c, i) => c === node.children[i])
    ? node
    : { ...node, children };
}

/**
 * Guarantee the tree still draws a terminal, unfolding its first pane if not.
 *
 * Folding is only allowed while another pane is still showing, but *removing*
 * panes can retire the ones that were: fold two panes of a three-way split and
 * close the third, and what's left is a tab of title bars with nothing to type
 * into. Every path that drops a leaf comes through here, so that tab can't be
 * reached — by a close, a drag onto another tab, or a reconcile against the
 * daemon after another window closed the pane this one was showing.
 */
function ensureSomethingShows(node: PaneNode | null): PaneNode | null {
  if (!node || showsTerminal(node)) return node;
  return setLeafCollapsed(node, firstLeafId(node), false);
}

/** The first leaf's terminal id (used to re-pick focus). */
export function firstLeafId(node: PaneNode): string {
  let cur = node;
  while (cur.type === "split") cur = cur.children[0];
  return cur.terminalId;
}

/**
 * Place `inserted` beside the leaf identified by `targetId`, on the side
 * `before` names. If the target's parent split already runs in `direction`, the
 * node joins it as a sibling and the sizes are evened out. Otherwise the target
 * leaf is replaced by a fresh split holding the two at even sizes. Returns a new
 * tree; unrelated nodes are shared.
 */
function insertBeside(
  node: PaneNode,
  targetId: string,
  inserted: PaneNode,
  direction: SplitDirection,
  before: boolean,
): PaneNode {
  if (node.type === "leaf") {
    if (node.terminalId !== targetId) return node;
    return {
      type: "split",
      direction,
      children: before ? [inserted, node] : [node, inserted],
      sizes: [0.5, 0.5],
    };
  }

  const idx = node.children.findIndex(
    (c) => c.type === "leaf" && c.terminalId === targetId,
  );

  if (idx !== -1 && node.direction === direction) {
    // Join the same-direction parent rather than nesting.
    const at = before ? idx : idx + 1;
    const children = [
      ...node.children.slice(0, at),
      inserted,
      ...node.children.slice(at),
    ];
    return { ...node, children, sizes: evenSizes(children.length) };
  }

  if (idx !== -1) {
    // Direct child, different direction: replace it with a nested split that
    // occupies the same slot (parent sizes unchanged).
    const children = node.children.map((c, i) =>
      i === idx
        ? {
            type: "split" as const,
            direction,
            children: before ? [inserted, c] : [c, inserted],
            sizes: [0.5, 0.5],
          }
        : c,
    );
    return { ...node, children };
  }

  // Target is deeper — recurse.
  return {
    ...node,
    children: node.children.map((c) =>
      insertBeside(c, targetId, inserted, direction, before),
    ),
  };
}

/**
 * Split the leaf identified by `targetId`, adding a new leaf for `newId` after
 * it — a new pane always opens to the right of / below the one it came from.
 */
export function splitLeaf(
  node: PaneNode,
  targetId: string,
  newId: string,
  direction: SplitDirection,
): PaneNode {
  return insertBeside(node, targetId, leaf(newId), direction, false);
}

/** The tree's arrangement, ignoring sizes — two trees that lay panes out in the
 *  same order and nesting share a shape key. */
function shapeKey(node: PaneNode): string {
  if (node.type === "leaf") return node.terminalId;
  return `${node.direction}(${node.children.map(shapeKey).join(",")})`;
}

/**
 * Move the pane `sourceId` so it sits against `edge` of `targetId`: lift it out
 * of the tree (collapsing whatever it leaves behind) and re-insert it beside the
 * target. This is the drag-to-rearrange gesture.
 *
 * Returns the original tree when the move can't be made, and — the reason
 * `shapeKey` exists — when the pane would land exactly where it already is. A
 * drop that changes nothing shouldn't quietly even out the sizes the user had
 * dragged the dividers to.
 */
export function movePane(
  node: PaneNode,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): PaneNode {
  if (sourceId === targetId) return node;
  const ids = collectLeafIds(node);
  if (!ids.includes(sourceId) || !ids.includes(targetId)) return node;

  const without = removeLeaf(node, sourceId);
  if (!without) return node;

  const direction: SplitDirection =
    edge === "left" || edge === "right" ? "row" : "column";
  const before = edge === "left" || edge === "top";
  const next = insertBeside(
    without,
    targetId,
    leaf(sourceId),
    direction,
    before,
  );
  return shapeKey(next) === shapeKey(node) ? node : next;
}

/**
 * Remove the leaf for `targetId`. Splits left with a single child collapse into
 * that child; a split emptied entirely returns null. Returns the new tree, or
 * null if the whole tree was the removed leaf.
 */
export function removeLeaf(node: PaneNode, targetId: string): PaneNode | null {
  return ensureSomethingShows(removeLeafFrom(node, targetId));
}

function removeLeafFrom(node: PaneNode, targetId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.terminalId === targetId ? null : node;
  }

  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = removeLeafFrom(child, targetId);
    if (next !== null) {
      children.push(next);
      sizes.push(node.sizes[i]);
    }
  });

  return rebuildSplit(node.direction, children, sizes);
}

/**
 * Keep only leaves whose id is in `keep`. Same collapse rules as `removeLeaf`.
 * Returns null if nothing survives.
 */
export function pruneLeaves(
  node: PaneNode,
  keep: ReadonlySet<string>,
): PaneNode | null {
  return ensureSomethingShows(pruneLeavesOf(node, keep));
}

function pruneLeavesOf(
  node: PaneNode,
  keep: ReadonlySet<string>,
): PaneNode | null {
  if (node.type === "leaf") {
    return keep.has(node.terminalId) ? node : null;
  }
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = pruneLeavesOf(child, keep);
    if (next !== null) {
      children.push(next);
      sizes.push(node.sizes[i]);
    }
  });
  return rebuildSplit(node.direction, children, sizes);
}

/**
 * Move the tab at `fromIndex` so it lands at `toIndex` in the resulting list
 * (drag-to-reorder). Returns the original array untouched when the move is a
 * no-op or either index is out of range, so a reducer can skip the state write.
 */
export function reorderTabs(
  tabs: TerminalTab[],
  fromIndex: number,
  toIndex: number,
): TerminalTab[] {
  if (fromIndex === toIndex) return tabs;
  if (fromIndex < 0 || fromIndex >= tabs.length) return tabs;
  if (toIndex < 0 || toIndex >= tabs.length) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Get the split node at `path` (child-index list from the root), or null. */
export function nodeAtPath(node: PaneNode, path: number[]): PaneNode | null {
  let cur: PaneNode = node;
  for (const i of path) {
    if (cur.type !== "split" || !cur.children[i]) return null;
    cur = cur.children[i];
  }
  return cur;
}

/**
 * Return a new tree with the split node at `path` given `sizes`. Used by the
 * divider drag. A no-op (returns the original) if the path doesn't resolve to a
 * split with a matching child count.
 */
export function setSizesAtPath(
  node: PaneNode,
  path: number[],
  sizes: number[],
): PaneNode {
  if (path.length === 0) {
    if (node.type !== "split" || node.sizes.length !== sizes.length)
      return node;
    return { ...node, sizes: normalize(sizes) };
  }
  if (node.type !== "split") return node;
  const [head, ...rest] = path;
  const child = node.children[head];
  if (!child) return node;
  const nextChild = setSizesAtPath(child, rest, sizes);
  if (nextChild === child) return node;
  const children = node.children.map((c, i) => (i === head ? nextChild : c));
  return { ...node, children };
}

// ----- Persisted layout -----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Rebuild one pane tree from unverified JSON, dropping anything that doesn't
 * describe a tree the panel can draw. `seen` carries the terminal ids already
 * claimed, so no session ends up in two panes.
 */
function sanitizeNode(value: unknown, seen: Set<string>): PaneNode | null {
  if (!isRecord(value)) return null;

  if (value.type === "leaf") {
    const terminalId = value.terminalId;
    if (typeof terminalId !== "string" || !terminalId) return null;
    if (seen.has(terminalId)) return null;
    seen.add(terminalId);
    return value.collapsed === true
      ? { type: "leaf", terminalId, collapsed: true }
      : leaf(terminalId);
  }

  if (value.type !== "split" || !Array.isArray(value.children)) return null;

  const rawSizes = Array.isArray(value.sizes) ? value.sizes : [];
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  value.children.forEach((child, i) => {
    const node = sanitizeNode(child, seen);
    if (!node) return;
    children.push(node);
    const size = rawSizes[i];
    sizes.push(Number.isFinite(size) && size > 0 ? size : 0);
  });

  return rebuildSplit(
    value.direction === "column" ? "column" : "row",
    children,
    // One unusable fraction discards the whole row rather than mixing a stored
    // size with an invented one, which would draw a layout nobody dragged.
    sizes.every((s) => s > 0) ? sizes : evenSizes(children.length),
  );
}

/**
 * Rebuild a tab list from the persisted layout — unverified JSON, since it is
 * a file on disk written by an older version of this app or edited by hand.
 *
 * Nothing here trusts its input: a malformed pane, a size array that doesn't
 * line up with its children, the same terminal claimed twice, a tab of nothing
 * but folded panes — each is repaired or dropped rather than restored into a
 * tree the renderer would trip over. Sessions are *not* checked here; that is
 * the daemon's answer, and the caller reconciles against it.
 */
export function sanitizeTabs(value: unknown): TerminalTab[] {
  if (!Array.isArray(value)) return [];
  const seenTabs = new Set<string>();
  const seenTerminals = new Set<string>();
  const tabs: TerminalTab[] = [];

  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string" || !id || seenTabs.has(id)) continue;
    const tab = withRepairedFocus(
      { id, focused: typeof raw.focused === "string" ? raw.focused : "" },
      ensureSomethingShows(sanitizeNode(raw.root, seenTerminals)),
    );
    if (!tab) continue;
    seenTabs.add(id);
    tabs.push(tab);
  }

  return tabs;
}
