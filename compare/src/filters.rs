//! File path filtering utilities.
//!
//! Provides patterns for filtering out build artifacts, binary files,
//! and other paths that should be skipped during diff analysis.

use regex::Regex;
use std::sync::LazyLock;

/// Patterns for files/directories that should be skipped during diff analysis.
/// These typically contain binary files or build artifacts that aren't useful to review.
static SKIP_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Rust build artifacts
        Regex::new(r"^target/").unwrap(),
        Regex::new(r"/target/").unwrap(),
        // Cargo fingerprints (binary metadata)
        Regex::new(r"\.fingerprint/").unwrap(),
        // Node.js dependencies
        Regex::new(r"^node_modules/").unwrap(),
        Regex::new(r"/node_modules/").unwrap(),
        // Git internals (shouldn't normally appear in diffs, but just in case)
        Regex::new(r"\.git/").unwrap(),
        // Python bytecode
        Regex::new(r"__pycache__/").unwrap(),
        Regex::new(r"\.pyc$").unwrap(),
        // Common build directories
        Regex::new(r"^dist/").unwrap(),
        Regex::new(r"^build/").unwrap(),
        Regex::new(r"/\.next/").unwrap(),
        Regex::new(r"^\.next/").unwrap(),
        // Package lock files (often very noisy diffs)
        Regex::new(r"package-lock\.json$").unwrap(),
        Regex::new(r"yarn\.lock$").unwrap(),
        Regex::new(r"Cargo\.lock$").unwrap(),
        Regex::new(r"pnpm-lock\.yaml$").unwrap(),
    ]
});

/// Check if a file path should be skipped (likely binary/build artifact).
///
/// Returns true if the path matches any skip pattern.
///
/// # Examples
///
/// ```
/// use compare::filters::should_skip_file;
///
/// assert!(should_skip_file("target/debug/myapp"));
/// assert!(should_skip_file("node_modules/lodash/index.js"));
/// assert!(!should_skip_file("src/main.rs"));
/// ```
pub fn should_skip_file(path: &str) -> bool {
    SKIP_PATTERNS.iter().any(|pattern| pattern.is_match(path))
}

/// Get the list of skip pattern descriptions for documentation/UI purposes.
pub fn get_skip_pattern_descriptions() -> Vec<(&'static str, &'static str)> {
    vec![
        ("target/", "Rust build artifacts"),
        ("node_modules/", "Node.js dependencies"),
        (".fingerprint/", "Cargo fingerprints"),
        (".git/", "Git internals"),
        ("__pycache__/", "Python bytecode"),
        ("dist/, build/", "Build output directories"),
        (".next/", "Next.js build cache"),
        ("*.lock", "Package lock files"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skip_rust_target() {
        assert!(should_skip_file("target/debug/myapp"));
        assert!(should_skip_file("target/release/libfoo.rlib"));
        assert!(should_skip_file("crates/foo/target/debug/deps/foo.d"));
    }

    #[test]
    fn test_skip_node_modules() {
        assert!(should_skip_file("node_modules/lodash/index.js"));
        assert!(should_skip_file("packages/ui/node_modules/.bin/tsc"));
    }

    #[test]
    fn test_skip_fingerprint() {
        assert!(should_skip_file(
            "target/debug/.fingerprint/foo-123abc/lib-foo"
        ));
    }

    #[test]
    fn test_skip_git() {
        assert!(should_skip_file(".git/objects/pack/pack-abc.idx"));
    }

    #[test]
    fn test_skip_python() {
        assert!(should_skip_file("src/__pycache__/module.cpython-39.pyc"));
        assert!(should_skip_file("module.pyc"));
    }

    #[test]
    fn test_skip_build_dirs() {
        assert!(should_skip_file("dist/bundle.js"));
        assert!(should_skip_file("build/index.html"));
        assert!(should_skip_file(".next/cache/webpack/abc.pack"));
    }

    #[test]
    fn test_skip_lock_files() {
        assert!(should_skip_file("package-lock.json"));
        assert!(should_skip_file("yarn.lock"));
        assert!(should_skip_file("Cargo.lock"));
        assert!(should_skip_file("pnpm-lock.yaml"));
    }

    #[test]
    fn test_dont_skip_source_files() {
        assert!(!should_skip_file("src/main.rs"));
        assert!(!should_skip_file("src/components/App.tsx"));
        assert!(!should_skip_file("README.md"));
        assert!(!should_skip_file("Cargo.toml"));
        assert!(!should_skip_file("package.json"));
    }

    #[test]
    fn test_dont_skip_similar_names() {
        // "target" in filename but not as directory
        assert!(!should_skip_file("src/target.rs"));
        assert!(!should_skip_file("docs/targeting.md"));
    }
}
