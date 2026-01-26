use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustPattern {
    pub id: String,
    #[serde(default)]
    pub category: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub patterns: Vec<TrustPattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaxonomyFile {
    categories: Vec<TrustCategory>,
}

/// Load the trust taxonomy from JSON.
/// First tries to load from bundled resources, then falls back to hardcoded.
pub fn load_taxonomy_from_json() -> Vec<TrustCategory> {
    // Try to load from bundled resource
    let json_str = include_str!("../../resources/taxonomy.json");
    match serde_json::from_str::<TaxonomyFile>(json_str) {
        Ok(taxonomy) => {
            // Fill in category field for each pattern
            taxonomy
                .categories
                .into_iter()
                .map(|mut cat| {
                    for pattern in &mut cat.patterns {
                        if pattern.category.is_empty() {
                            pattern.category = cat.id.clone();
                        }
                    }
                    cat
                })
                .collect()
        }
        Err(e) => {
            eprintln!(
                "[load_taxonomy_from_json] Failed to parse bundled taxonomy: {}",
                e
            );
            get_default_taxonomy()
        }
    }
}

/// Load custom patterns from a repository's .git/compare/custom-patterns.json
/// Returns an empty vec if the file doesn't exist or can't be parsed.
pub fn load_custom_patterns(repo_path: &PathBuf) -> Vec<TrustCategory> {
    let custom_path = repo_path
        .join(".git")
        .join("compare")
        .join("custom-patterns.json");

    if !custom_path.exists() {
        return vec![];
    }

    match std::fs::read_to_string(&custom_path) {
        Ok(content) => match serde_json::from_str::<TaxonomyFile>(&content) {
            Ok(taxonomy) => {
                eprintln!(
                    "[load_custom_patterns] Loaded {} custom categories from {:?}",
                    taxonomy.categories.len(),
                    custom_path
                );
                taxonomy
                    .categories
                    .into_iter()
                    .map(|mut cat| {
                        for pattern in &mut cat.patterns {
                            if pattern.category.is_empty() {
                                pattern.category = cat.id.clone();
                            }
                        }
                        cat
                    })
                    .collect()
            }
            Err(e) => {
                eprintln!(
                    "[load_custom_patterns] Failed to parse custom patterns at {:?}: {}",
                    custom_path, e
                );
                vec![]
            }
        },
        Err(e) => {
            eprintln!(
                "[load_custom_patterns] Failed to read custom patterns at {:?}: {}",
                custom_path, e
            );
            vec![]
        }
    }
}

/// Get the full trust taxonomy, merging bundled patterns with custom patterns.
/// Custom patterns are appended to the bundled taxonomy.
pub fn get_trust_taxonomy_with_custom(repo_path: &PathBuf) -> Vec<TrustCategory> {
    let mut taxonomy = load_taxonomy_from_json();
    let custom = load_custom_patterns(repo_path);

    // Merge custom categories - add new ones or extend existing
    for custom_cat in custom {
        if let Some(existing) = taxonomy.iter_mut().find(|c| c.id == custom_cat.id) {
            // Extend existing category with new patterns
            for pattern in custom_cat.patterns {
                if !existing.patterns.iter().any(|p| p.id == pattern.id) {
                    existing.patterns.push(pattern);
                }
            }
        } else {
            // Add new category
            taxonomy.push(custom_cat);
        }
    }

    taxonomy
}

/// The full taxonomy of trust patterns (bundled)
pub fn get_trust_taxonomy() -> Vec<TrustCategory> {
    load_taxonomy_from_json()
}

/// Fallback hardcoded taxonomy in case JSON loading fails
fn get_default_taxonomy() -> Vec<TrustCategory> {
    vec![
        TrustCategory {
            id: "imports".to_string(),
            name: "Imports".to_string(),
            description: "Changes to import statements".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "imports:added".to_string(),
                    category: "imports".to_string(),
                    name: "Added".to_string(),
                    description: "New import statements added".to_string(),
                },
                TrustPattern {
                    id: "imports:removed".to_string(),
                    category: "imports".to_string(),
                    name: "Removed".to_string(),
                    description: "Import statements removed".to_string(),
                },
                TrustPattern {
                    id: "imports:reordered".to_string(),
                    category: "imports".to_string(),
                    name: "Reordered".to_string(),
                    description: "Import statements reordered".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "formatting".to_string(),
            name: "Formatting".to_string(),
            description: "Code style and formatting changes".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "formatting:whitespace".to_string(),
                    category: "formatting".to_string(),
                    name: "Whitespace".to_string(),
                    description: "Whitespace-only changes (spaces, tabs, blank lines)".to_string(),
                },
                TrustPattern {
                    id: "formatting:line-length".to_string(),
                    category: "formatting".to_string(),
                    name: "Line length".to_string(),
                    description: "Line wrapping for length limits".to_string(),
                },
                TrustPattern {
                    id: "formatting:style".to_string(),
                    category: "formatting".to_string(),
                    name: "Style".to_string(),
                    description: "Code style changes (semicolons, quotes, etc.)".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "comments".to_string(),
            name: "Comments".to_string(),
            description: "Changes to code comments".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "comments:added".to_string(),
                    category: "comments".to_string(),
                    name: "Added".to_string(),
                    description: "New comments added".to_string(),
                },
                TrustPattern {
                    id: "comments:removed".to_string(),
                    category: "comments".to_string(),
                    name: "Removed".to_string(),
                    description: "Comments removed".to_string(),
                },
                TrustPattern {
                    id: "comments:modified".to_string(),
                    category: "comments".to_string(),
                    name: "Modified".to_string(),
                    description: "Comments updated or corrected".to_string(),
                },
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_taxonomy_from_json() {
        let taxonomy = load_taxonomy_from_json();
        assert!(!taxonomy.is_empty());

        // Check that we have the expected categories
        let category_ids: Vec<&str> = taxonomy.iter().map(|c| c.id.as_str()).collect();
        assert!(category_ids.contains(&"imports"));
        assert!(category_ids.contains(&"formatting"));
        assert!(category_ids.contains(&"comments"));
    }

    #[test]
    fn test_patterns_have_category_filled() {
        let taxonomy = load_taxonomy_from_json();
        for category in &taxonomy {
            for pattern in &category.patterns {
                assert!(!pattern.category.is_empty());
                assert_eq!(pattern.category, category.id);
            }
        }
    }

    #[test]
    fn test_pattern_id_format() {
        let taxonomy = load_taxonomy_from_json();
        for category in &taxonomy {
            for pattern in &category.patterns {
                // Pattern ID should be in format "category:name"
                assert!(pattern.id.starts_with(&format!("{}:", category.id)));
            }
        }
    }

    #[test]
    fn test_custom_patterns_nonexistent_path() {
        let fake_path = PathBuf::from("/nonexistent/path");
        let custom = load_custom_patterns(&fake_path);
        assert!(custom.is_empty());
    }
}
