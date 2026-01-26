use crate::sources::traits::Comparison;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewState {
    pub comparison: Comparison,
    pub hunks: HashMap<String, HunkState>,
    #[serde(rename = "trustList")]
    pub trust_list: Vec<String>,
    pub notes: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkState {
    #[serde(default)]
    pub label: Vec<String>,
    pub reasoning: Option<String>,
    #[serde(rename = "approvedVia")]
    pub approved_via: Option<ApprovalMethod>,
    #[serde(default)]
    pub rejected: Option<bool>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalMethod {
    Manual,
    Trust,
    Ai,
}

impl ReviewState {
    pub fn new(comparison: Comparison) -> Self {
        let now = chrono_now();
        Self {
            comparison,
            hunks: HashMap::new(),
            trust_list: Vec::new(),
            notes: String::new(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

fn chrono_now() -> String {
    // ISO 8601 timestamp without external crate
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

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
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
