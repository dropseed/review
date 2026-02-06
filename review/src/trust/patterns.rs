use serde::{Deserialize, Serialize};
use std::path::Path;

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

/// Fill in empty `category` fields on each pattern from the parent category ID.
fn fill_pattern_categories(categories: Vec<TrustCategory>) -> Vec<TrustCategory> {
    categories
        .into_iter()
        .map(|mut cat| {
            for pattern in &mut cat.patterns {
                if pattern.category.is_empty() {
                    pattern.category.clone_from(&cat.id);
                }
            }
            cat
        })
        .collect()
}

/// Load the trust taxonomy from JSON.
/// First tries to load from bundled resources, then falls back to hardcoded.
pub fn load_taxonomy_from_json() -> Vec<TrustCategory> {
    let json_str = include_str!("../../resources/taxonomy.json");
    match serde_json::from_str::<TaxonomyFile>(json_str) {
        Ok(taxonomy) => fill_pattern_categories(taxonomy.categories),
        Err(e) => {
            eprintln!("[load_taxonomy_from_json] Failed to parse bundled taxonomy: {e}");
            get_default_taxonomy()
        }
    }
}

/// Load custom patterns from a repository's central storage directory.
/// Returns an empty vec if the file doesn't exist or can't be parsed.
///
/// Note: This function returns an empty vec on errors to allow graceful degradation.
/// Errors are logged for debugging but don't prevent the app from working.
pub fn load_custom_patterns(repo_path: &Path) -> Vec<TrustCategory> {
    let custom_path = match crate::review::central::get_repo_storage_dir(repo_path) {
        Ok(dir) => dir.join("custom-patterns.json"),
        Err(e) => {
            eprintln!("[load_custom_patterns] Could not resolve central storage dir: {e}");
            return vec![];
        }
    };

    if !custom_path.exists() {
        return vec![];
    }

    match std::fs::read_to_string(&custom_path) {
        Ok(content) => match serde_json::from_str::<TaxonomyFile>(&content) {
            Ok(taxonomy) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[load_custom_patterns] Loaded {} custom categories from {}",
                    taxonomy.categories.len(),
                    custom_path.display()
                );
                fill_pattern_categories(taxonomy.categories)
            }
            Err(e) => {
                eprintln!(
                    "[load_custom_patterns] Warning: Failed to parse custom patterns at {}: {e}",
                    custom_path.display()
                );
                vec![]
            }
        },
        Err(e) => {
            eprintln!(
                "[load_custom_patterns] Warning: Failed to read custom patterns at {}: {e}",
                custom_path.display()
            );
            vec![]
        }
    }
}

/// Get the full trust taxonomy, merging bundled patterns with custom patterns.
/// Custom patterns are appended to the bundled taxonomy.
pub fn get_trust_taxonomy_with_custom(repo_path: &Path) -> Vec<TrustCategory> {
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

use std::collections::HashSet;
use std::sync::OnceLock;

/// Cached set of valid pattern IDs for efficient validation.
/// Loaded once on first access and reused for all subsequent calls.
static VALID_PATTERN_IDS: OnceLock<HashSet<String>> = OnceLock::new();

/// Get all valid pattern IDs from the taxonomy (cached after first call)
pub fn get_valid_pattern_ids() -> &'static HashSet<String> {
    VALID_PATTERN_IDS.get_or_init(|| {
        get_trust_taxonomy()
            .into_iter()
            .flat_map(|cat| cat.patterns.into_iter().map(|p| p.id))
            .collect()
    })
}

/// Check if a label is a valid pattern ID in the taxonomy (O(1) lookup)
pub fn is_valid_pattern_id(label: &str) -> bool {
    get_valid_pattern_ids().contains(label)
}

/// Fallback hardcoded taxonomy in case JSON loading fails
fn get_default_taxonomy() -> Vec<TrustCategory> {
    vec![
        TrustCategory {
            id: "imports".to_owned(),
            name: "Imports".to_owned(),
            description: "Changes to import statements".to_owned(),
            patterns: vec![
                TrustPattern {
                    id: "imports:added".to_owned(),
                    category: "imports".to_owned(),
                    name: "Added".to_owned(),
                    description: "New import statements added".to_owned(),
                },
                TrustPattern {
                    id: "imports:removed".to_owned(),
                    category: "imports".to_owned(),
                    name: "Removed".to_owned(),
                    description: "Import statements removed".to_owned(),
                },
                TrustPattern {
                    id: "imports:reordered".to_owned(),
                    category: "imports".to_owned(),
                    name: "Reordered".to_owned(),
                    description: "Import statements reordered".to_owned(),
                },
            ],
        },
        TrustCategory {
            id: "formatting".to_owned(),
            name: "Formatting".to_owned(),
            description: "Code style and formatting changes".to_owned(),
            patterns: vec![
                TrustPattern {
                    id: "formatting:whitespace".to_owned(),
                    category: "formatting".to_owned(),
                    name: "Whitespace".to_owned(),
                    description: "Whitespace-only changes (spaces, tabs, blank lines)".to_owned(),
                },
                TrustPattern {
                    id: "formatting:line-length".to_owned(),
                    category: "formatting".to_owned(),
                    name: "Line length".to_owned(),
                    description: "Line wrapping for length limits".to_owned(),
                },
                TrustPattern {
                    id: "formatting:style".to_owned(),
                    category: "formatting".to_owned(),
                    name: "Style".to_owned(),
                    description: "Code style changes (semicolons, quotes, etc.)".to_owned(),
                },
            ],
        },
        TrustCategory {
            id: "comments".to_owned(),
            name: "Comments".to_owned(),
            description: "Changes to code comments".to_owned(),
            patterns: vec![
                TrustPattern {
                    id: "comments:added".to_owned(),
                    category: "comments".to_owned(),
                    name: "Added".to_owned(),
                    description: "New comments added".to_owned(),
                },
                TrustPattern {
                    id: "comments:removed".to_owned(),
                    category: "comments".to_owned(),
                    name: "Removed".to_owned(),
                    description: "Comments removed".to_owned(),
                },
                TrustPattern {
                    id: "comments:modified".to_owned(),
                    category: "comments".to_owned(),
                    name: "Modified".to_owned(),
                    description: "Comments updated or corrected".to_owned(),
                },
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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
