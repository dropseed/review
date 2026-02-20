use serde::{Deserialize, Serialize};

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
fn load_taxonomy_from_json() -> Vec<TrustCategory> {
    let json_str = include_str!("../../resources/taxonomy.json");
    match serde_json::from_str::<TaxonomyFile>(json_str) {
        Ok(taxonomy) => fill_pattern_categories(taxonomy.categories),
        Err(e) => {
            eprintln!("[load_taxonomy_from_json] Failed to parse bundled taxonomy: {e}");
            get_default_taxonomy()
        }
    }
}

/// The full taxonomy of trust patterns (bundled)
pub fn get_trust_taxonomy() -> Vec<TrustCategory> {
    load_taxonomy_from_json()
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
}
