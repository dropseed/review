use crate::sources::traits::Comparison;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A line annotation for inline comments
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineAnnotation {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "lineNumber")]
    pub line_number: u32,
    pub side: AnnotationSide,
    pub content: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationSide {
    Old,
    New,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewState {
    pub comparison: Comparison,
    pub hunks: HashMap<String, HunkState>,
    #[serde(rename = "trustList")]
    pub trust_list: Vec<String>,
    pub notes: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub annotations: Vec<LineAnnotation>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "completedAt", skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkState {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub label: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<HunkStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HunkStatus {
    Approved,
    Rejected,
}

impl ReviewState {
    pub fn new(comparison: Comparison) -> Self {
        let now = chrono_now();
        Self {
            comparison,
            hunks: HashMap::new(),
            trust_list: Vec::new(),
            notes: String::new(),
            annotations: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
        }
    }

    /// Create a summary of this review state
    pub fn to_summary(&self) -> ReviewSummary {
        let total_hunks = self.hunks.len();
        // Count hunks that are approved, rejected, or have labels matching trust list
        let reviewed_hunks = self
            .hunks
            .values()
            .filter(|h| {
                // Explicitly approved or rejected
                if h.status.is_some() {
                    return true;
                }
                // Has a label that matches a trust pattern
                if !h.label.is_empty() {
                    for label in &h.label {
                        for pattern in &self.trust_list {
                            if label_matches_pattern(label, pattern) {
                                return true;
                            }
                        }
                    }
                }
                false
            })
            .count();

        ReviewSummary {
            comparison: self.comparison.clone(),
            total_hunks,
            reviewed_hunks,
            updated_at: self.updated_at.clone(),
            completed_at: self.completed_at.clone(),
        }
    }
}

/// Check if a label matches a pattern (supports wildcards)
fn label_matches_pattern(label: &str, pattern: &str) -> bool {
    if pattern == label {
        return true;
    }
    // Handle wildcard patterns like "imports:*"
    if let Some(prefix) = pattern.strip_suffix('*') {
        return label.starts_with(prefix);
    }
    false
}

fn chrono_now() -> String {
    // ISO 8601 timestamp without external crate (with milliseconds for JS compatibility)
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();

    // Convert to ISO 8601 format (simplified UTC)
    // Days since Unix epoch
    let days = secs / 86400;
    let remaining = secs % 86400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;

    // Calculate year, month, day from days since epoch (1970-01-01)
    let mut year = 1970i32;
    let mut remaining_days = days as i32;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months: [i32; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for days_in_month in days_in_months.iter() {
        if remaining_days < *days_in_month {
            break;
        }
        remaining_days -= *days_in_month;
        month += 1;
    }
    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hours, minutes, seconds, millis
    )
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Summary information about a saved review (for listing on start screen)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSummary {
    pub comparison: Comparison,
    #[serde(rename = "totalHunks")]
    pub total_hunks: usize,
    #[serde(rename = "reviewedHunks")]
    pub reviewed_hunks: usize,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "completedAt", skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}
