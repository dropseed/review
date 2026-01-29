/// Pattern matching utilities for trust patterns.
///
/// Supports glob-style patterns where `*` matches any sequence of characters.
///
/// Examples:
/// - `imports:*` matches `imports:added`, `imports:removed`
/// - `imports:added` matches only `imports:added`
/// - `*:removed` matches `imports:removed`, `comments:removed`
/// - `imports` does NOT match `imports:added` (exact match only without wildcard)

/// Check if a label matches a pattern.
///
/// Supports wildcards (`*`) that match any sequence of characters.
/// Without wildcards, performs exact matching only.
pub fn matches_pattern(label: &str, pattern: &str) -> bool {
    // If no wildcards, use exact match
    if !pattern.contains('*') {
        return label == pattern;
    }

    simple_glob_match(label, pattern)
}

/// Simple glob matching without regex crate.
/// Supports `*` as a wildcard that matches any sequence of characters.
fn simple_glob_match(label: &str, pattern: &str) -> bool {
    // Handle patterns with wildcards
    let parts: Vec<&str> = pattern.split('*').collect();

    if parts.len() == 1 {
        // No wildcards, exact match
        return label == pattern;
    }

    let mut remaining = label;

    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }

        if i == 0 {
            // First part must be at the start
            if !remaining.starts_with(part) {
                return false;
            }
            remaining = &remaining[part.len()..];
        } else if i == parts.len() - 1 {
            // Last part must be at the end
            if !remaining.ends_with(part) {
                return false;
            }
            // All matched
            return true;
        } else {
            // Middle parts can be anywhere
            if let Some(pos) = remaining.find(part) {
                remaining = &remaining[pos + part.len()..];
            } else {
                return false;
            }
        }
    }

    true
}

/// Check if a label matches any pattern in a list.
pub fn matches_any_pattern(label: &str, patterns: &[String]) -> bool {
    patterns
        .iter()
        .any(|pattern| matches_pattern(label, pattern))
}

/// Check if any label in a list matches any pattern.
pub fn any_label_matches_any_pattern(labels: &[String], patterns: &[String]) -> bool {
    labels
        .iter()
        .any(|label| matches_any_pattern(label, patterns))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Parity tests - these must pass in both TypeScript and Rust

    #[test]
    fn test_exact_match() {
        assert!(matches_pattern("imports:added", "imports:added"));
        assert!(!matches_pattern("imports:added", "imports:removed"));
    }

    #[test]
    fn test_suffix_wildcard() {
        assert!(matches_pattern("imports:added", "imports:*"));
        assert!(matches_pattern("imports:removed", "imports:*"));
        assert!(!matches_pattern("comments:added", "imports:*"));
    }

    #[test]
    fn test_prefix_wildcard() {
        assert!(matches_pattern("imports:added", "*:added"));
        assert!(matches_pattern("comments:added", "*:added"));
        assert!(!matches_pattern("imports:removed", "*:added"));
    }

    #[test]
    fn test_pattern_without_wildcard_no_prefix_match() {
        // CRITICAL: "imports" without wildcard should NOT match "imports:added"
        assert!(!matches_pattern("imports:added", "imports"));
    }

    #[test]
    fn test_regex_special_chars() {
        // Dots should be literal, not regex "any char"
        assert!(matches_pattern("file.name", "file.name"));
        assert!(!matches_pattern("filexname", "file.name"));
    }

    #[test]
    fn test_empty_strings() {
        assert!(matches_pattern("", ""));
        assert!(matches_pattern("", "*"));
        assert!(!matches_pattern("something", ""));
    }

    #[test]
    fn test_wildcard_only() {
        assert!(matches_pattern("anything", "*"));
        assert!(matches_pattern("imports:added", "*"));
        assert!(matches_pattern("", "*"));
    }

    #[test]
    fn test_double_wildcard() {
        assert!(matches_pattern("imports:added", "*:*"));
        assert!(matches_pattern("a:b", "*:*"));
    }

    #[test]
    fn test_matches_any_pattern() {
        let patterns = vec!["imports:*".to_string(), "formatting:*".to_string()];

        assert!(matches_any_pattern("imports:added", &patterns));
        assert!(matches_any_pattern("formatting:whitespace", &patterns));
        assert!(!matches_any_pattern("comments:added", &patterns));
    }

    #[test]
    fn test_any_label_matches_any_pattern() {
        let labels = vec!["imports:added".to_string(), "code:logic".to_string()];
        let patterns = vec!["imports:*".to_string()];

        assert!(any_label_matches_any_pattern(&labels, &patterns));

        let labels2 = vec!["code:logic".to_string(), "comments:added".to_string()];
        assert!(!any_label_matches_any_pattern(&labels2, &patterns));
    }

    #[test]
    fn test_empty_pattern_list() {
        assert!(!matches_any_pattern("imports:added", &[]));
    }
}
