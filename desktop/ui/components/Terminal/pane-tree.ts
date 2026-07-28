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

export type PaneNode =
  | { type: "leaf"; terminalId: string }
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
  /**
   * Shown from every repo and worktree, not just its own bucket. The tab still
   * belongs to one key — pinning changes where it is *visible*, never where it
   * lives, so unpinning is lossless.
   */
  pinned?: boolean;
}

export function leaf(terminalId: string): PaneNode {
  return { type: "leaf", terminalId };
}

export function makeTab(
  id: string,
  terminalId: string,
  pinned = false,
): TerminalTab {
  return { id, root: leaf(terminalId), focused: terminalId, pinned };
}

/** Even fractions for `n` children (sums to 1). */
export function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
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

/** The first leaf's terminal id (used to re-pick focus). */
export function firstLeafId(node: PaneNode): string {
  let cur = node;
  while (cur.type === "split") cur = cur.children[0];
  return cur.terminalId;
}

/**
 * Split the leaf identified by `targetId`, adding a new leaf for `newId`. If
 * the target's parent split already runs in `direction`, the new leaf is
 * appended as a sibling right after the target and the sizes are evened out.
 * Otherwise the target leaf is replaced by a fresh split `[target, new]` at
 * even sizes. Returns a new tree; unrelated nodes are shared.
 */
export function splitLeaf(
  node: PaneNode,
  targetId: string,
  newId: string,
  direction: SplitDirection,
): PaneNode {
  if (node.type === "leaf") {
    if (node.terminalId !== targetId) return node;
    return {
      type: "split",
      direction,
      children: [node, leaf(newId)],
      sizes: [0.5, 0.5],
    };
  }

  const idx = node.children.findIndex(
    (c) => c.type === "leaf" && c.terminalId === targetId,
  );

  if (idx !== -1 && node.direction === direction) {
    // Append into the same-direction parent rather than nesting.
    const children = [
      ...node.children.slice(0, idx + 1),
      leaf(newId),
      ...node.children.slice(idx + 1),
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
            children: [c, leaf(newId)],
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
      splitLeaf(c, targetId, newId, direction),
    ),
  };
}

/**
 * Remove the leaf for `targetId`. Splits left with a single child collapse into
 * that child; a split emptied entirely returns null. Returns the new tree, or
 * null if the whole tree was the removed leaf.
 */
export function removeLeaf(node: PaneNode, targetId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.terminalId === targetId ? null : node;
  }

  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = removeLeaf(child, targetId);
    if (next !== null) {
      children.push(next);
      sizes.push(node.sizes[i]);
    }
  });

  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalize(sizes) };
}

/**
 * Keep only leaves whose id is in `keep`. Same collapse rules as `removeLeaf`.
 * Returns null if nothing survives.
 */
export function pruneLeaves(
  node: PaneNode,
  keep: ReadonlySet<string>,
): PaneNode | null {
  if (node.type === "leaf") {
    return keep.has(node.terminalId) ? node : null;
  }
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = pruneLeaves(child, keep);
    if (next !== null) {
      children.push(next);
      sizes.push(node.sizes[i]);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalize(sizes) };
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
