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

/// Load the trust taxonomy from the bundled JSON.
///
/// The file is `include_str!`-compiled into the binary, so it cannot be missing
/// or edited at runtime: a parse failure is a build bug, not a condition to
/// recover from. Failing loudly beats serving a silently smaller taxonomy —
/// every pattern is trusted by default on a fresh review, so a missing pattern
/// would quietly stop auto-approving a whole class of hunks.
fn load_taxonomy_from_json() -> Vec<TrustCategory> {
    let json_str = include_str!("../../resources/taxonomy.json");
    let taxonomy: TaxonomyFile = serde_json::from_str(json_str)
        .expect("bundled resources/taxonomy.json is malformed — fix the resource");
    fill_pattern_categories(taxonomy.categories)
}

/// The full taxonomy of trust patterns (bundled)
pub fn get_trust_taxonomy() -> Vec<TrustCategory> {
    load_taxonomy_from_json()
}

/// Return all pattern IDs from the taxonomy (e.g. "imports:added", "formatting:whitespace", etc.)
pub fn get_all_pattern_ids() -> Vec<String> {
    get_trust_taxonomy()
        .into_iter()
        .flat_map(|cat| cat.patterns.into_iter().map(|p| p.id))
        .collect()
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
