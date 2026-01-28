//! Detect active Claude Code sessions for a given repository.
//!
//! Claude Code stores session transcripts at:
//!   ~/.claude/projects/<project-dir-name>/<uuid>.jsonl
//!
//! The project directory name is the repo's absolute path with `/` replaced by `-`.
//! Session files are written in real-time, so a recent mtime indicates an active session.

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::SystemTime;

/// Status of Claude Code sessions for a repository.
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeCodeStatus {
    /// Whether there is an active session (modified within the last 5 minutes).
    pub active: bool,
    /// Number of session files found.
    pub session_count: usize,
    /// ISO 8601 timestamp of the most recent session activity, if any.
    pub last_activity: Option<String>,
}

/// A single parsed message from a Claude Code session transcript.
#[derive(Debug, Clone, Serialize)]
pub struct SessionMessage {
    /// ISO 8601 timestamp of the message.
    pub timestamp: String,
    /// Type of message: "text", "tool_use", or "user".
    pub message_type: String,
    /// Human-readable summary (truncated).
    pub summary: String,
}

/// A session entry from the sessions index, with computed status.
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub last_activity: String,
    pub status: String,
    pub message_count: usize,
    pub summary: String,
    pub git_branch: String,
    /// The session this was continued/resumed from.
    pub parent_session_id: Option<String>,
    /// The root session ID (same for all sessions in a chain).
    pub chain_id: Option<String>,
    /// Order within the chain (0 = root).
    pub chain_position: usize,
}

/// A message from a chain of sessions, with session context.
#[derive(Debug, Clone, Serialize)]
pub struct ChainMessage {
    pub timestamp: String,
    pub message_type: String,
    pub summary: String,
    /// Which session this message came from.
    pub session_id: String,
    /// Summary of the session this message belongs to.
    pub session_summary: String,
}

/// Resolve the Claude Code projects directory for a given repository path.
///
/// Returns `None` if the path cannot be resolved or the directory doesn't exist.
fn resolve_projects_dir(repo_path: &str) -> Option<PathBuf> {
    let repo_abs = std::fs::canonicalize(repo_path).ok()?;
    let repo_str = repo_abs.to_string_lossy();
    let project_dir_name = repo_str.replace('/', "-");

    let home = dirs::home_dir()?;
    let projects_dir = home
        .join(".claude")
        .join("projects")
        .join(&project_dir_name);

    if projects_dir.is_dir() {
        Some(projects_dir)
    } else {
        None
    }
}

/// Find the most recently modified .jsonl file in a directory.
fn find_most_recent_jsonl(dir: &PathBuf) -> Option<(PathBuf, SystemTime)> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut best: Option<(PathBuf, SystemTime)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            if let Ok(metadata) = path.metadata() {
                if let Ok(mtime) = metadata.modified() {
                    best = Some(match best {
                        Some((prev_path, prev_time)) if mtime > prev_time => (path, mtime),
                        Some(prev) => prev,
                        None => (path, mtime),
                    });
                }
            }
        }
    }

    best
}

/// Check for active Claude Code sessions in the given repository.
///
/// Returns a `ClaudeCodeStatus` indicating whether any session files
/// have been modified recently (within 5 minutes).
pub fn check_sessions(repo_path: &str) -> ClaudeCodeStatus {
    let inactive = ClaudeCodeStatus {
        active: false,
        session_count: 0,
        last_activity: None,
    };

    let projects_dir = match resolve_projects_dir(repo_path) {
        Some(d) => d,
        None => return inactive,
    };

    // Scan for .jsonl files and find the most recent mtime
    let entries = match std::fs::read_dir(&projects_dir) {
        Ok(e) => e,
        Err(_) => return inactive,
    };

    let mut session_count = 0usize;
    let mut most_recent: Option<SystemTime> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            session_count += 1;
            if let Ok(metadata) = path.metadata() {
                if let Ok(mtime) = metadata.modified() {
                    most_recent = Some(match most_recent {
                        Some(prev) if mtime > prev => mtime,
                        Some(prev) => prev,
                        None => mtime,
                    });
                }
            }
        }
    }

    let (active, last_activity) = match most_recent {
        Some(mtime) => {
            let elapsed = SystemTime::now().duration_since(mtime).unwrap_or_default();
            let active = elapsed.as_secs() < 300; // 5 minutes
            let last_activity = system_time_to_iso8601(mtime);
            (active, Some(last_activity))
        }
        None => (false, None),
    };

    ClaudeCodeStatus {
        active,
        session_count,
        last_activity,
    }
}

/// Classify a timestamp into a status category based on how recent it is.
fn classify_session_status(modified_iso: &str) -> String {
    let now = SystemTime::now();
    let now_secs = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Parse ISO 8601 timestamp to seconds since epoch (simple parser for common format)
    let modified_secs = parse_iso8601_to_epoch(modified_iso).unwrap_or(0);
    let elapsed = now_secs.saturating_sub(modified_secs);

    if elapsed < 300 {
        "active".to_string()
    } else if elapsed < 3600 {
        "recent".to_string()
    } else {
        // Check if it's today: compare date portions
        let now_days = now_secs / 86400;
        let modified_days = modified_secs / 86400;
        if now_days == modified_days {
            "today".to_string()
        } else {
            "older".to_string()
        }
    }
}

/// Parse a simple ISO 8601 timestamp to seconds since epoch.
fn parse_iso8601_to_epoch(iso: &str) -> Option<u64> {
    // Handles formats like "2026-01-28T12:00:00.000Z" or "2026-01-28T12:00:00Z"
    // or "2026-01-28T12:00:00+00:00"
    let s = iso.trim();
    if s.len() < 19 {
        return None;
    }

    let year: u64 = s[0..4].parse().ok()?;
    let month: u64 = s[5..7].parse().ok()?;
    let day: u64 = s[8..10].parse().ok()?;
    let hour: u64 = s[11..13].parse().ok()?;
    let min: u64 = s[14..16].parse().ok()?;
    let sec: u64 = s[17..19].parse().ok()?;

    // Convert date to days since epoch using the inverse of days_to_date
    // Simple approach: count days
    let mut total_days: u64 = 0;
    for y in 1970..year {
        total_days += if is_leap_year(y) { 366 } else { 365 };
    }
    let days_in_months = [
        31,
        if is_leap_year(year) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for m in 0..(month.saturating_sub(1) as usize) {
        total_days += days_in_months[m];
    }
    total_days += day.saturating_sub(1);

    Some(total_days * 86400 + hour * 3600 + min * 60 + sec)
}

fn is_leap_year(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// List sessions from the sessions-index.json file.
///
/// Reads the index, filters out subagent sessions (<=2 messages),
/// sorts by modified descending, and returns the top `limit` sessions.
pub fn list_sessions(repo_path: &str, limit: usize) -> Vec<SessionInfo> {
    let projects_dir = match resolve_projects_dir(repo_path) {
        Some(d) => d,
        None => return vec![],
    };

    let index_path = projects_dir.join("sessions-index.json");
    let content = match std::fs::read_to_string(&index_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let index: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let entries = match index.get("entries").and_then(|e| e.as_array()) {
        Some(arr) => arr,
        None => return vec![],
    };

    let mut sessions: Vec<SessionInfo> = entries
        .iter()
        .filter_map(|entry| {
            let message_count = entry
                .get("messageCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;

            // Filter out subagent sessions
            if message_count <= 2 {
                return None;
            }

            let session_id = entry
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let modified = entry
                .get("modified")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if session_id.is_empty() || modified.is_empty() {
                return None;
            }

            let summary_text = entry.get("summary").and_then(|v| v.as_str()).unwrap_or("");

            let summary = if summary_text.is_empty() {
                let first_prompt = entry
                    .get("firstPrompt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("(no prompt)");
                truncate_str(first_prompt, 100)
            } else {
                truncate_str(summary_text, 100)
            };

            let git_branch = entry
                .get("gitBranch")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let status = classify_session_status(&modified);

            Some(SessionInfo {
                session_id,
                last_activity: modified,
                status,
                message_count,
                summary,
                git_branch,
                parent_session_id: None,
                chain_id: None,
                chain_position: 0,
            })
        })
        .collect();

    // Sort by last_activity descending (most recent first)
    sessions.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));

    // Return top `limit`
    sessions.truncate(limit);

    // Resolve session chains
    resolve_session_chains(&mut sessions, &projects_dir);

    sessions
}

/// Get recent messages from a Claude Code session for a repository.
///
/// If `session_id` is provided, reads that specific session file.
/// Otherwise, reads the most recently modified session file.
///
/// Returns the last `limit` messages, most recent first.
pub fn get_recent_messages(
    repo_path: &str,
    limit: usize,
    session_id: Option<&str>,
) -> Vec<SessionMessage> {
    let projects_dir = match resolve_projects_dir(repo_path) {
        Some(d) => d,
        None => return vec![],
    };

    let jsonl_path = if let Some(sid) = session_id {
        let path = projects_dir.join(format!("{}.jsonl", sid));
        if !path.exists() {
            return vec![];
        }
        path
    } else {
        match find_most_recent_jsonl(&projects_dir) {
            Some((path, _)) => path,
            None => return vec![],
        }
    };

    // Read the file and take the last ~500 lines for parsing
    let content = match std::fs::read_to_string(&jsonl_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let lines: Vec<&str> = content.lines().collect();
    let start = if lines.len() > 500 {
        lines.len() - 500
    } else {
        0
    };

    let mut messages = Vec::new();

    for line in &lines[start..] {
        let entry: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = match entry.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };

        let timestamp = entry
            .get("timestamp")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        if timestamp.is_empty() {
            continue;
        }

        match entry_type {
            "assistant" => {
                let content_arr = match entry
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    Some(arr) => arr,
                    None => continue,
                };

                for item in content_arr {
                    let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");

                    match item_type {
                        "tool_use" => {
                            let tool_name = item
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("unknown");

                            let summary = summarize_tool_use(tool_name, item.get("input"));
                            messages.push(SessionMessage {
                                timestamp: timestamp.clone(),
                                message_type: "tool_use".to_string(),
                                summary,
                            });
                        }
                        "text" => {
                            let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                            if !text.is_empty() {
                                let summary = truncate_str(text, 2000);
                                messages.push(SessionMessage {
                                    timestamp: timestamp.clone(),
                                    message_type: "text".to_string(),
                                    summary,
                                });
                            }
                        }
                        _ => {} // skip thinking, etc.
                    }
                }
            }
            "user" => {
                let content_arr = match entry
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    Some(arr) => arr,
                    None => continue,
                };

                for item in content_arr {
                    let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");

                    if item_type == "text" {
                        let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                        if !text.is_empty() {
                            let summary = truncate_str(text, 2000);
                            messages.push(SessionMessage {
                                timestamp: timestamp.clone(),
                                message_type: "user".to_string(),
                                summary,
                            });
                        }
                    }
                    // Skip tool_result entries
                }
            }
            _ => {} // skip progress, file-history-snapshot, etc.
        }
    }

    // Return last `limit` items in chronological order (oldest first)
    let start_idx = if messages.len() > limit {
        messages.len() - limit
    } else {
        0
    };
    messages[start_idx..].to_vec()
}

/// Resolve session chains by reading JSONL files to find parent links.
///
/// For each session, reads the first few lines of its JSONL file to find
/// `logicalParentUuid`, then builds a UUID→sessionId map to resolve parent
/// session IDs. Finally, walks chains to compute chain_id and chain_position.
fn resolve_session_chains(sessions: &mut Vec<SessionInfo>, projects_dir: &PathBuf) {
    let session_ids: Vec<String> = sessions.iter().map(|s| s.session_id.clone()).collect();

    // Maps: uuid → session_id (message UUIDs to their owning session)
    let mut uuid_to_session: HashMap<String, String> = HashMap::new();
    // Maps: session_id → logicalParentUuid
    let mut session_parent_uuid: HashMap<String, String> = HashMap::new();

    for sid in &session_ids {
        let jsonl_path = projects_dir.join(format!("{}.jsonl", sid));
        if let Ok(content) = std::fs::read_to_string(&jsonl_path) {
            for (line_num, line) in content.lines().enumerate() {
                let entry: serde_json::Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                // Check for logicalParentUuid in the first few lines
                if line_num < 5 {
                    if let Some(parent_uuid) =
                        entry.get("logicalParentUuid").and_then(|v| v.as_str())
                    {
                        if !parent_uuid.is_empty() {
                            session_parent_uuid.insert(sid.clone(), parent_uuid.to_string());
                        }
                    }
                }

                // Collect message UUIDs from assistant and user messages
                if let Some(uuid) = entry.get("uuid").and_then(|v| v.as_str()) {
                    if !uuid.is_empty() {
                        uuid_to_session.insert(uuid.to_string(), sid.clone());
                    }
                }
            }
        }
    }

    // Resolve logicalParentUuid → parent session ID
    let mut child_to_parent: HashMap<String, String> = HashMap::new();
    for (child_sid, parent_uuid) in &session_parent_uuid {
        if let Some(parent_sid) = uuid_to_session.get(parent_uuid) {
            // Only link if the parent session is in our current result set
            if session_ids.contains(parent_sid) {
                child_to_parent.insert(child_sid.clone(), parent_sid.clone());
            }
        }
    }

    // Walk chains: for each session, find the root
    let mut session_chain_id: HashMap<String, String> = HashMap::new();
    let mut session_chain_pos: HashMap<String, usize> = HashMap::new();

    for sid in &session_ids {
        // Walk up the chain to find root
        let mut current = sid.clone();
        let mut chain: Vec<String> = vec![current.clone()];
        while let Some(parent) = child_to_parent.get(&current) {
            if chain.contains(parent) {
                break; // Avoid cycles
            }
            chain.push(parent.clone());
            current = parent.clone();
        }

        // Root is the last element (we walked upward)
        let root_id = chain.last().unwrap().clone();

        // Only set chain_id if there's more than one session in the chain
        // Walk from root down to compute positions
        if chain.len() > 1 {
            session_chain_id.insert(sid.clone(), root_id);
        }
    }

    // For sessions that have a chain_id, compute positions by walking from root
    // Build parent_to_children map
    let mut parent_to_children: HashMap<String, Vec<String>> = HashMap::new();
    for (child, parent) in &child_to_parent {
        parent_to_children
            .entry(parent.clone())
            .or_default()
            .push(child.clone());
    }

    // For each unique chain root, walk the tree to assign positions
    let roots: Vec<String> = session_chain_id
        .values()
        .cloned()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    for root in &roots {
        let mut pos = 0;
        let mut queue = vec![root.clone()];
        while let Some(current) = queue.first().cloned() {
            queue.remove(0);
            session_chain_pos.insert(current.clone(), pos);
            pos += 1;
            if let Some(children) = parent_to_children.get(&current) {
                // Sort children by last_activity so chain order is chronological
                let mut sorted_children = children.clone();
                sorted_children.sort_by(|a, b| {
                    let a_time = sessions
                        .iter()
                        .find(|s| s.session_id == *a)
                        .map(|s| &s.last_activity);
                    let b_time = sessions
                        .iter()
                        .find(|s| s.session_id == *b)
                        .map(|s| &s.last_activity);
                    a_time.cmp(&b_time)
                });
                queue.extend(sorted_children);
            }
        }
    }

    // Apply results to sessions
    for session in sessions.iter_mut() {
        if let Some(parent_sid) = child_to_parent.get(&session.session_id) {
            session.parent_session_id = Some(parent_sid.clone());
        }
        if let Some(chain_id) = session_chain_id.get(&session.session_id) {
            session.chain_id = Some(chain_id.clone());
        }
        if let Some(pos) = session_chain_pos.get(&session.session_id) {
            session.chain_position = *pos;
        }
    }
}

/// Get all messages from a chain of sessions, merged into a single timeline.
///
/// Given a session ID, finds all sessions in its chain, reads messages from
/// each in chain order, and returns them with session metadata.
pub fn get_chain_messages(repo_path: &str, session_id: &str, limit: usize) -> Vec<ChainMessage> {
    // First, get sessions to find chain info
    let sessions = list_sessions(repo_path, 50);

    let target = sessions.iter().find(|s| s.session_id == session_id);
    let chain_id = match target {
        Some(s) => match &s.chain_id {
            Some(cid) => cid.clone(),
            None => {
                // Not part of a chain — return single session messages
                let messages = get_recent_messages(repo_path, limit, Some(session_id));
                let summary = target.map(|s| s.summary.clone()).unwrap_or_default();
                return messages
                    .into_iter()
                    .map(|m| ChainMessage {
                        timestamp: m.timestamp,
                        message_type: m.message_type,
                        summary: m.summary,
                        session_id: session_id.to_string(),
                        session_summary: summary.clone(),
                    })
                    .collect();
            }
        },
        None => return vec![],
    };

    // Collect all sessions in the chain, sorted by chain_position
    let mut chain_sessions: Vec<&SessionInfo> = sessions
        .iter()
        .filter(|s| s.chain_id.as_deref() == Some(&chain_id))
        .collect();
    chain_sessions.sort_by_key(|s| s.chain_position);

    // Read messages from each session and merge
    let mut all_messages = Vec::new();
    let per_session_limit = limit / chain_sessions.len().max(1);

    for cs in &chain_sessions {
        let msgs = get_recent_messages(repo_path, per_session_limit.max(50), Some(&cs.session_id));
        for msg in msgs {
            all_messages.push(ChainMessage {
                timestamp: msg.timestamp,
                message_type: msg.message_type,
                summary: msg.summary,
                session_id: cs.session_id.clone(),
                session_summary: cs.summary.clone(),
            });
        }
    }

    // Messages are already in chronological order per session, and sessions
    // are in chain order, so the overall order should be correct.
    // Truncate to limit
    if all_messages.len() > limit {
        let start = all_messages.len() - limit;
        all_messages = all_messages[start..].to_vec();
    }

    all_messages
}

/// Summarize a tool_use entry into a human-readable string.
fn summarize_tool_use(tool_name: &str, input: Option<&serde_json::Value>) -> String {
    let key_value = input.and_then(|inp| {
        // Try common input keys to build a meaningful summary
        if let Some(path) = inp.get("file_path").and_then(|v| v.as_str()) {
            return Some(path.to_string());
        }
        if let Some(path) = inp.get("path").and_then(|v| v.as_str()) {
            return Some(path.to_string());
        }
        if let Some(cmd) = inp.get("command").and_then(|v| v.as_str()) {
            return Some(truncate_str(cmd, 200));
        }
        if let Some(pattern) = inp.get("pattern").and_then(|v| v.as_str()) {
            return Some(pattern.to_string());
        }
        if let Some(query) = inp.get("query").and_then(|v| v.as_str()) {
            return Some(truncate_str(query, 200));
        }
        if let Some(prompt) = inp.get("prompt").and_then(|v| v.as_str()) {
            return Some(truncate_str(prompt, 200));
        }
        if let Some(desc) = inp.get("description").and_then(|v| v.as_str()) {
            return Some(truncate_str(desc, 200));
        }
        None
    });

    match key_value {
        Some(val) => format!("{}: {}", tool_name, val),
        None => tool_name.to_string(),
    }
}

/// Truncate a string to a maximum number of characters, adding "..." if truncated.
fn truncate_str(s: &str, max_len: usize) -> String {
    // Trim whitespace and collapse newlines
    let cleaned: String = s
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if cleaned.len() <= max_len {
        cleaned
    } else {
        let truncated: String = cleaned.chars().take(max_len).collect();
        format!("{}...", truncated)
    }
}

/// Convert a SystemTime to an ISO 8601 string.
fn system_time_to_iso8601(time: SystemTime) -> String {
    let duration = time
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Simple UTC conversion without external crate
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate date from days since epoch (1970-01-01)
    let (year, month, day) = days_to_date(days);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

/// Convert days since Unix epoch to (year, month, day).
fn days_to_date(days: u64) -> (u64, u64, u64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
