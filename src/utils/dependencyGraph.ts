import type {
  FileSymbolDiff,
  SymbolDiff,
  DependencyGraph,
  SymbolEdge,
  FileCluster,
} from "../types";

/** Get or create a value in a Map. */
function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (!value) {
    value = create();
    map.set(key, value);
  }
  return value;
}

/**
 * Build a dependency graph from file symbol diffs.
 *
 * Ports the Rust `build_dependency_graph` algorithm:
 * 1. Build symbolName -> Set<filePath> map from SymbolDiff trees
 * 2. Build directed edges from defining files to referencing files
 * 3. Union-find connected components into clusters
 */
export function buildDependencyGraph(
  fileDiffs: FileSymbolDiff[],
): DependencyGraph {
  // Step 1: Build symbol -> defining files map
  const symbolToFiles = new Map<string, Set<string>>();

  function collectSymbolNames(symbols: SymbolDiff[], filePath: string): void {
    for (const sym of symbols) {
      getOrCreate(symbolToFiles, sym.name, () => new Set()).add(filePath);
      collectSymbolNames(sym.children, filePath);
    }
  }

  for (const diff of fileDiffs) {
    collectSymbolNames(diff.symbols, diff.filePath);
  }

  // Step 2: Build edges
  // Key: "definesFile\0referencesFile" -> Set<symbolName>
  const edgeMap = new Map<string, Set<string>>();

  for (const diff of fileDiffs) {
    for (const ref of diff.symbolReferences) {
      const definingFiles = symbolToFiles.get(ref.symbolName);
      if (!definingFiles) continue;

      for (const definingFile of definingFiles) {
        if (definingFile === diff.filePath) continue;

        const key = `${definingFile}\0${diff.filePath}`;
        getOrCreate(edgeMap, key, () => new Set()).add(ref.symbolName);
      }
    }
  }

  const edges: SymbolEdge[] = [];
  for (const [key, symbols] of edgeMap) {
    const [definesFile, referencesFile] = key.split("\0");
    edges.push({
      definesFile,
      referencesFile,
      symbols: [...symbols].sort(),
    });
  }
  edges.sort((a, b) => {
    return (
      a.definesFile.localeCompare(b.definesFile) ||
      a.referencesFile.localeCompare(b.referencesFile)
    );
  });

  // Step 3: Union-find connected components
  const allFiles = fileDiffs.map((d) => d.filePath);
  const parent = new Map<string, string>();
  for (const f of allFiles) {
    parent.set(f, f);
  }

  function find(x: string): string {
    const p = parent.get(x) ?? x;
    if (p === x) return p;
    const root = find(p);
    parent.set(x, root);
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const edge of edges) {
    union(edge.definesFile, edge.referencesFile);
  }

  // Group files by root
  const components = new Map<string, string[]>();
  for (const file of allFiles) {
    getOrCreate(components, find(file), () => []).push(file);
  }

  // Build clusters
  const clusters: FileCluster[] = [];
  for (const files of components.values()) {
    files.sort();
    const fileSet = new Set(files);
    const clusterEdges = edges.filter(
      (e) => fileSet.has(e.definesFile) || fileSet.has(e.referencesFile),
    );
    clusters.push({ files, edges: clusterEdges });
  }

  // Sort: multi-file clusters first (by size desc), then singletons alphabetically
  clusters.sort((a, b) => {
    if (a.files.length > 1 !== b.files.length > 1) {
      return b.files.length - a.files.length;
    }
    if (a.files.length > 1) {
      if (a.files.length !== b.files.length) {
        return b.files.length - a.files.length;
      }
      for (let i = 0; i < a.files.length; i++) {
        const cmp = a.files[i].localeCompare(b.files[i]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    }
    return a.files[0].localeCompare(b.files[0]);
  });

  return { edges, clusters };
}
