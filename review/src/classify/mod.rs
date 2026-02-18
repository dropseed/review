pub mod static_rules;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub use static_rules::classify_hunks_static;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub label: Vec<String>,
    pub reasoning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyResponse {
    pub classifications: HashMap<String, ClassificationResult>,
}
