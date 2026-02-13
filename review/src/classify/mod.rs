pub mod static_rules;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub use static_rules::{classify_hunks_static, should_skip_ai};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub label: Vec<String>,
    pub reasoning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyResponse {
    pub classifications: HashMap<String, ClassificationResult>,
    /// Hunk IDs that were skipped (not sent to AI) because heuristics
    /// determined they are very unlikely to match any taxonomy label.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_hunk_ids: Vec<String>,
}
