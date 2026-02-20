//! Dependency graph construction from file symbol diffs.
//!
//! Takes the output of symbol diff analysis and produces a graph of
//! cross-file symbol dependencies, grouped into connected components.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::{FileSymbolDiff, SymbolDiff};

/// A directed edge: file A defines/modifies symbol(s) that file B references.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolEdge {
    #[serde(rename = "definesFile")]
    pub defines_file: String,
    #[serde(rename = "referencesFile")]
    pub references_file: String,
    /// Sorted symbol names creating this connection.
    pub symbols: Vec<String>,
}

/// A connected component of files linked through shared symbols.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileCluster {
    /// Sorted file paths.
    pub files: Vec<String>,
    /// Edges within this cluster.
    pub edges: Vec<SymbolEdge>,
}

/// The complete dependency structure of a diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyGraph {
    pub edges: Vec<SymbolEdge>,
    pub clusters: Vec<FileCluster>,
}

/// Build a dependency graph from file symbol diffs.
///
/// 1. Builds a map of symbol name → defining file paths
/// 2. Creates directed edges from defining files to referencing files
/// 3. Groups files into connected components (clusters)
pub fn build_dependency_graph(file_diffs: &[FileSymbolDiff]) -> DependencyGraph {
    // Step 1: Build symbol → defining files map
    let mut symbol_to_files: HashMap<String, HashSet<String>> = HashMap::new();
    for diff in file_diffs {
        collect_symbol_names(&diff.symbols, &diff.file_path, &mut symbol_to_files);
    }

    // Step 2: Build edges
    // Key is (defines_file, references_file), value is the set of connecting symbols
    let mut edge_map: HashMap<(String, String), HashSet<String>> = HashMap::new();

    for diff in file_diffs {
        for sym_ref in &diff.symbol_references {
            if let Some(defining_files) = symbol_to_files.get(&sym_ref.symbol_name) {
                for defining_file in defining_files {
                    // Skip self-edges
                    if defining_file == &diff.file_path {
                        continue;
                    }
                    edge_map
                        .entry((defining_file.clone(), diff.file_path.clone()))
                        .or_default()
                        .insert(sym_ref.symbol_name.clone());
                }
            }
        }
    }

    let mut edges: Vec<SymbolEdge> = edge_map
        .into_iter()
        .map(|((defines_file, references_file), symbols)| {
            let mut symbols: Vec<String> = symbols.into_iter().collect();
            symbols.sort();
            SymbolEdge {
                defines_file,
                references_file,
                symbols,
            }
        })
        .collect();
    edges.sort_by(|a, b| {
        a.defines_file
            .cmp(&b.defines_file)
            .then(a.references_file.cmp(&b.references_file))
    });

    // Step 3: Find connected components via union-find
    let all_files: Vec<String> = file_diffs.iter().map(|d| d.file_path.clone()).collect();
    let mut uf = UnionFind::new(&all_files);

    for edge in &edges {
        uf.union(&edge.defines_file, &edge.references_file);
    }

    // Group files by their root
    let mut components: HashMap<String, Vec<String>> = HashMap::new();
    for file in &all_files {
        let root = uf.find(file);
        components.entry(root).or_default().push(file.clone());
    }

    // Build clusters
    let mut clusters: Vec<FileCluster> = components
        .into_values()
        .map(|mut files| {
            files.sort();
            let cluster_files: HashSet<&str> = files.iter().map(|s| s.as_str()).collect();
            let cluster_edges: Vec<SymbolEdge> = edges
                .iter()
                .filter(|e| {
                    cluster_files.contains(e.defines_file.as_str())
                        || cluster_files.contains(e.references_file.as_str())
                })
                .cloned()
                .collect();
            FileCluster {
                files,
                edges: cluster_edges,
            }
        })
        .collect();

    // Sort: multi-file clusters first (by size desc), then singletons alphabetically
    clusters.sort_by(|a, b| {
        let a_multi = a.files.len() > 1;
        let b_multi = b.files.len() > 1;
        match (a_multi, b_multi) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (true, true) => b
                .files
                .len()
                .cmp(&a.files.len())
                .then(a.files.cmp(&b.files)),
            (false, false) => a.files.cmp(&b.files),
        }
    });

    DependencyGraph { edges, clusters }
}

/// Recursively collect symbol names from a `SymbolDiff` tree.
fn collect_symbol_names(
    symbols: &[SymbolDiff],
    file_path: &str,
    map: &mut HashMap<String, HashSet<String>>,
) {
    for sym in symbols {
        map.entry(sym.name.clone())
            .or_default()
            .insert(file_path.to_owned());
        collect_symbol_names(&sym.children, file_path, map);
    }
}

/// Simple union-find (disjoint set) over string keys.
struct UnionFind {
    parent: HashMap<String, String>,
}

impl UnionFind {
    fn new(items: &[String]) -> Self {
        let parent = items.iter().map(|s| (s.clone(), s.clone())).collect();
        Self { parent }
    }

    fn find(&mut self, x: &str) -> String {
        let p = self.parent.get(x).cloned().unwrap_or_else(|| x.to_owned());
        if p == x {
            return p;
        }
        let root = self.find(&p);
        self.parent.insert(x.to_owned(), root.clone());
        root
    }

    fn union(&mut self, a: &str, b: &str) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            self.parent.insert(ra, rb);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{SymbolChangeType, SymbolReference};

    fn make_file_diff(
        file_path: &str,
        symbols: Vec<SymbolDiff>,
        references: Vec<SymbolReference>,
    ) -> FileSymbolDiff {
        FileSymbolDiff {
            file_path: file_path.to_owned(),
            symbols,
            top_level_hunk_ids: vec![],
            has_grammar: true,
            symbol_references: references,
        }
    }

    fn make_symbol(name: &str) -> SymbolDiff {
        SymbolDiff {
            name: name.to_owned(),
            kind: None,
            change_type: SymbolChangeType::Modified,
            hunk_ids: vec![],
            children: vec![],
            old_range: None,
            new_range: None,
        }
    }

    fn make_ref(symbol_name: &str) -> SymbolReference {
        SymbolReference {
            symbol_name: symbol_name.to_owned(),
            hunk_id: "hunk1".to_owned(),
            line_numbers: vec![1],
        }
    }

    #[test]
    fn two_files_connected_by_shared_symbol() {
        let diffs = vec![
            make_file_diff("src/auth.rs", vec![make_symbol("authenticate")], vec![]),
            make_file_diff("src/handler.rs", vec![], vec![make_ref("authenticate")]),
        ];

        let graph = build_dependency_graph(&diffs);

        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.edges[0].defines_file, "src/auth.rs");
        assert_eq!(graph.edges[0].references_file, "src/handler.rs");
        assert_eq!(graph.edges[0].symbols, vec!["authenticate"]);

        assert_eq!(graph.clusters.len(), 1);
        assert_eq!(
            graph.clusters[0].files,
            vec!["src/auth.rs", "src/handler.rs"]
        );
        assert_eq!(graph.clusters[0].edges.len(), 1);
    }

    #[test]
    fn standalone_file_becomes_singleton_cluster() {
        let diffs = vec![
            make_file_diff("src/auth.rs", vec![make_symbol("authenticate")], vec![]),
            make_file_diff("src/handler.rs", vec![], vec![make_ref("authenticate")]),
            make_file_diff("src/utils.rs", vec![make_symbol("format")], vec![]),
        ];

        let graph = build_dependency_graph(&diffs);

        // One multi-file cluster + one singleton
        assert_eq!(graph.clusters.len(), 2);
        // Multi-file cluster comes first
        assert_eq!(graph.clusters[0].files.len(), 2);
        // Singleton
        assert_eq!(graph.clusters[1].files, vec!["src/utils.rs"]);
        assert!(graph.clusters[1].edges.is_empty());
    }

    #[test]
    fn self_reference_produces_no_edge() {
        let diffs = vec![make_file_diff(
            "src/lib.rs",
            vec![make_symbol("helper")],
            vec![make_ref("helper")],
        )];

        let graph = build_dependency_graph(&diffs);

        assert!(graph.edges.is_empty());
        assert_eq!(graph.clusters.len(), 1);
        assert_eq!(graph.clusters[0].files, vec!["src/lib.rs"]);
    }

    #[test]
    fn symbol_in_multiple_files_creates_edges_to_both() {
        // Two files define 'init', a third references it
        let diffs = vec![
            make_file_diff("src/db.rs", vec![make_symbol("init")], vec![]),
            make_file_diff("src/cache.rs", vec![make_symbol("init")], vec![]),
            make_file_diff("src/main.rs", vec![], vec![make_ref("init")]),
        ];

        let graph = build_dependency_graph(&diffs);

        // Two edges: db.rs→main.rs and cache.rs→main.rs
        assert_eq!(graph.edges.len(), 2);
        let edge_pairs: HashSet<(&str, &str)> = graph
            .edges
            .iter()
            .map(|e| (e.defines_file.as_str(), e.references_file.as_str()))
            .collect();
        assert!(edge_pairs.contains(&("src/db.rs", "src/main.rs")));
        assert!(edge_pairs.contains(&("src/cache.rs", "src/main.rs")));

        // All three files in one cluster
        assert_eq!(graph.clusters.len(), 1);
        assert_eq!(graph.clusters[0].files.len(), 3);
    }

    #[test]
    fn multiple_symbols_between_same_pair_aggregated() {
        let diffs = vec![
            make_file_diff(
                "src/models.rs",
                vec![make_symbol("User"), make_symbol("Session")],
                vec![],
            ),
            make_file_diff(
                "src/api.rs",
                vec![],
                vec![make_ref("User"), make_ref("Session")],
            ),
        ];

        let graph = build_dependency_graph(&diffs);

        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.edges[0].symbols, vec!["Session", "User"]);
    }

    #[test]
    fn empty_input_produces_empty_graph() {
        let graph = build_dependency_graph(&[]);
        assert!(graph.edges.is_empty());
        assert!(graph.clusters.is_empty());
    }
}
