use glob::Pattern;

/// Check if a label matches a trust pattern (supports wildcards)
///
/// Examples:
/// - "imports:*" matches "imports:added", "imports:removed"
/// - "imports:added" matches only "imports:added"
/// - "*" matches everything
pub fn matches_pattern(label: &str, pattern: &str) -> bool {
    // Convert our pattern syntax to glob syntax
    let glob_pattern = pattern.replace(':', "/");
    let label_path = label.replace(':', "/");

    if let Ok(p) = Pattern::new(&glob_pattern) {
        p.matches(&label_path)
    } else {
        // Fallback to exact match
        label == pattern
    }
}

/// Check if a label matches any pattern in the trust list
pub fn is_trusted(label: &str, trust_list: &[String]) -> bool {
    trust_list
        .iter()
        .any(|pattern| matches_pattern(label, pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        assert!(matches_pattern("imports:added", "imports:added"));
        assert!(!matches_pattern("imports:added", "imports:removed"));
    }

    #[test]
    fn test_wildcard_match() {
        assert!(matches_pattern("imports:added", "imports:*"));
        assert!(matches_pattern("imports:removed", "imports:*"));
        assert!(!matches_pattern("formatting:whitespace", "imports:*"));
    }

    #[test]
    fn test_is_trusted() {
        let trust_list = vec!["imports:*".to_string(), "formatting:whitespace".to_string()];

        assert!(is_trusted("imports:added", &trust_list));
        assert!(is_trusted("imports:removed", &trust_list));
        assert!(is_trusted("formatting:whitespace", &trust_list));
        assert!(!is_trusted("formatting:style", &trust_list));
    }
}
