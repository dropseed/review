pub mod matching;
pub mod patterns;

// Export pattern matching functions for use across the codebase
pub use matching::matches_pattern;

// These are available but currently only used in tests
#[allow(unused_imports)]
pub use matching::{any_label_matches_any_pattern, matches_any_pattern};
