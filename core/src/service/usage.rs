//! Agent usage — how much of your Claude and Codex rate limits you've spent.
//!
//! The two agents expose this very differently:
//!
//! * **Claude** answers a live question. `claude -p "/usage"` reports the
//!   current windows and consumes none of them (`total_cost_usd: 0`, zero
//!   tokens) — but it boots the whole CLI to do it, costing a second or two
//!   of CPU, which is what the cache and the slow poll interval are for.
//! * **Codex** has no such command, but records a `rate_limits` snapshot into
//!   its session rollout files as it works. We read the most recent one. That
//!   makes it ground truth rather than an estimate, but only as fresh as the
//!   last time Codex actually ran — hence `observed_at_unix`, which callers
//!   should surface so a stale number isn't mistaken for a live one.

use anyhow::{bail, Context, Result};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// One rate-limit window, e.g. Claude's 5-hour session or Codex's weekly cap.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Display name as the agent frames it ("Session", "Week (all models)").
    pub label: String,
    pub used_percent: f64,
    /// Unix seconds at which the window resets, when the agent gives a timestamp.
    pub resets_at_unix: Option<i64>,
    /// The agent's own reset wording, when that's all it gives (Claude).
    pub resets_at_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    /// Stable identifier: `claude` or `codex`.
    pub id: String,
    pub name: String,
    pub windows: Vec<UsageWindow>,
    /// Subscription tier, when reported (Codex: `plan_type`).
    pub plan: Option<String>,
    /// When the snapshot was taken. `None` means it was read live just now.
    pub observed_at_unix: Option<i64>,
}

/// Coalescing window for repeat reads. The UI polls far less often than this;
/// the TTL is here to absorb bursts — several windows mounting at once, or a
/// popover opening right after a scheduled poll — not to pace the refresh.
const CACHE_TTL: Duration = Duration::from_secs(60);

/// Ceiling on the `claude -p` subprocess. It normally returns in under a
/// second; anything beyond this is a hung CLI, not a slow one.
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(15);

type Cache = Mutex<Option<(Instant, Vec<AgentUsage>)>>;
static CACHE: OnceLock<Cache> = OnceLock::new();
/// Held across a refresh so concurrent callers wait for one in-flight read
/// rather than each spawning their own `claude` subprocess.
static REFRESH: OnceLock<Mutex<()>> = OnceLock::new();

/// Usage for every agent that has something to report, cached for [`CACHE_TTL`].
///
/// Agents that aren't installed, aren't logged in, or can't be read are simply
/// absent — the caller renders what it gets, and never has to decide whether an
/// agent is worth showing.
pub fn report() -> Result<Vec<AgentUsage>> {
    if let Some(cached) = cached_report() {
        return Ok(cached);
    }

    // Losing this race means someone else is already doing the work; take their
    // result instead of duplicating a ~2s subprocess.
    let _refreshing = lock(REFRESH.get_or_init(|| Mutex::new(())));
    if let Some(cached) = cached_report() {
        return Ok(cached);
    }

    let t0 = Instant::now();
    let agents: Vec<AgentUsage> = [claude_usage(), codex_usage()]
        .into_iter()
        .flatten()
        .collect();
    info!(
        "agent usage -> {} agents in {:?}",
        agents.len(),
        t0.elapsed()
    );

    *lock(CACHE.get_or_init(|| Mutex::new(None))) = Some((Instant::now(), agents.clone()));
    Ok(agents)
}

fn cached_report() -> Option<Vec<AgentUsage>> {
    let cache = lock(CACHE.get_or_init(|| Mutex::new(None)));
    let (cached_at, agents) = cache.as_ref()?;
    (cached_at.elapsed() < CACHE_TTL).then(|| agents.clone())
}

/// Take a lock, ignoring poisoning — a panic mid-refresh shouldn't disable
/// usage reporting for the rest of the process.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

// ============================================================
// Claude
// ============================================================

fn claude_usage() -> Option<AgentUsage> {
    let binary = crate::ai::find_claude_executable()?;

    let windows = match read_claude_usage(Path::new(&binary)) {
        Ok(windows) => windows,
        Err(e) => {
            debug!("claude usage unavailable: {e}");
            return None;
        }
    };

    // Empty means logged out, or billing through an API key rather than a
    // subscription — there are no limit windows to show.
    (!windows.is_empty()).then(|| AgentUsage {
        id: "claude".to_string(),
        name: "Claude".to_string(),
        windows,
        plan: None,
        observed_at_unix: None,
    })
}

fn read_claude_usage(binary: &Path) -> Result<Vec<UsageWindow>> {
    let mut cmd = Command::new(binary);
    // `/usage` is a slash command, so `--disable-slash-commands` (which the
    // rest of `crate::ai` applies) is out. The remaining hardening still is
    // not: skipping the user's settings, hooks and MCP config roughly halves
    // the CPU this costs, and none of it affects what `/usage` reports.
    cmd.args([
        "-p",
        "/usage",
        "--output-format",
        "json",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
    ]);

    let stdout = run_with_timeout(cmd, CLAUDE_TIMEOUT)?;
    let envelope: Value =
        serde_json::from_str(&stdout).context("claude did not return JSON output")?;

    if envelope.get("is_error").and_then(Value::as_bool) == Some(true) {
        bail!("claude reported an error running /usage");
    }

    let text = envelope
        .get("result")
        .and_then(Value::as_str)
        .context("claude output had no `result` field")?;

    Ok(parse_claude_windows(text))
}

/// Pull the limit lines out of `/usage`'s prose, which look like:
///
/// ```text
/// Current session: 8% used · resets Jul 25 at 2pm (America/Chicago)
/// Current week (all models): 85% used · resets Jul 28 at 2pm (America/Chicago)
/// ```
///
/// This is human-facing output with no stability guarantee, so anything that
/// doesn't match is skipped rather than treated as a failure — a wording change
/// in a future Claude Code should hide the indicator, not break the app.
fn parse_claude_windows(text: &str) -> Vec<UsageWindow> {
    let mut windows = Vec::new();

    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("Current ") else {
            continue;
        };
        let Some((label, value)) = rest.split_once(": ") else {
            continue;
        };
        let Some((percent, after)) = value.split_once("% used") else {
            continue;
        };
        let Ok(used_percent) = percent.trim().parse::<f64>() else {
            continue;
        };

        windows.push(UsageWindow {
            label: capitalize(label.trim()),
            used_percent,
            resets_at_unix: None,
            resets_at_text: after
                .split_once("resets ")
                .map(|(_, resets)| resets.trim().to_string()),
        });
    }

    windows
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Run `cmd`, capturing stdout, killing it if it outlives `timeout`.
///
/// stdout is drained on a side thread, so the channel closing *is* the
/// completion signal — the child has exited and the pipe is at EOF. That
/// doubles as the timeout, with no polling loop.
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to run {:?}", cmd.get_program()))?;

    let stdout = child.stdout.take().context("child had no stdout pipe")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = BufReader::new(stdout);
        let _ = reader.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(stdout) => {
            let _ = child.wait();
            Ok(stdout)
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            bail!("timed out after {}s", timeout.as_secs())
        }
    }
}

// ============================================================
// Codex
// ============================================================

/// How many recent session files to try before giving up. The newest session
/// may have been created without reaching a turn (no snapshot in it yet), so we
/// fall back through a few.
const CODEX_SESSIONS_TO_SCAN: usize = 12;

fn codex_usage() -> Option<AgentUsage> {
    let sessions_dir = super::util::codex_home()?.join("sessions");
    if !sessions_dir.is_dir() {
        return None;
    }

    for (path, modified) in recent_session_files(&sessions_dir, CODEX_SESSIONS_TO_SCAN) {
        let Some(snapshot) = last_rate_limits(&path) else {
            continue;
        };
        return Some(build_codex_usage(&snapshot, modified));
    }

    None
}

/// Session files newest-first. Codex has used a few layouts over time (flat
/// files at the root, and `YYYY/MM/DD/` subdirectories), so this walks rather
/// than assuming one.
fn recent_session_files(sessions_dir: &Path, limit: usize) -> Vec<(PathBuf, Option<i64>)> {
    let mut files: Vec<(PathBuf, SystemTime)> = walkdir::WalkDir::new(sessions_dir)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext == "jsonl" || ext == "json")
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path().to_path_buf(), modified))
        })
        .collect();

    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.truncate(limit);
    files
        .into_iter()
        .map(|(path, modified)| (path, to_unix(modified)))
        .collect()
}

/// The last `rate_limits` object written to a session file.
///
/// Scanned line by line and kept as text until the end, so a multi-megabyte
/// rollout costs one streaming pass and a single JSON parse.
fn last_rate_limits(path: &Path) -> Option<Value> {
    let file = std::fs::File::open(path).ok()?;
    let mut last: Option<String> = None;

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.contains("\"rate_limits\"") {
            last = Some(line);
        }
    }

    let parsed: Value = serde_json::from_str(&last?).ok()?;
    find_rate_limits(&parsed).cloned()
}

/// Locate the `rate_limits` object anywhere in an event. Codex has moved it
/// around its envelope between versions, so this searches rather than
/// hard-coding a path.
fn find_rate_limits(value: &Value) -> Option<&Value> {
    match value {
        Value::Object(map) => {
            if let Some(limits @ Value::Object(_)) = map.get("rate_limits") {
                return Some(limits);
            }
            map.values().find_map(find_rate_limits)
        }
        Value::Array(items) => items.iter().find_map(find_rate_limits),
        _ => None,
    }
}

fn build_codex_usage(snapshot: &Value, observed_at_unix: Option<i64>) -> AgentUsage {
    let windows = ["primary", "secondary"]
        .into_iter()
        .filter_map(|key| snapshot.get(key))
        .filter_map(parse_codex_window)
        .collect();

    AgentUsage {
        id: "codex".to_string(),
        name: "Codex".to_string(),
        windows,
        plan: snapshot
            .get("plan_type")
            .and_then(Value::as_str)
            .map(capitalize),
        observed_at_unix,
    }
}

fn parse_codex_window(window: &Value) -> Option<UsageWindow> {
    let used_percent = window.get("used_percent").and_then(Value::as_f64)?;
    let window_minutes = window.get("window_minutes").and_then(Value::as_u64);

    Some(UsageWindow {
        label: codex_window_label(window_minutes),
        used_percent,
        resets_at_unix: window.get("resets_at").and_then(Value::as_i64),
        resets_at_text: None,
    })
}

/// Name Codex's windows the way Claude names its own, so the two agents read as
/// one vocabulary in the UI rather than two.
fn codex_window_label(minutes: Option<u64>) -> String {
    match minutes {
        Some(300) => "Session".to_string(),
        Some(10080) => "Weekly".to_string(),
        Some(m) if m % 1440 == 0 => format!("{}d", m / 1440),
        Some(m) if m % 60 == 0 => format!("{}h", m / 60),
        Some(m) => format!("{m}m"),
        None => "Limit".to_string(),
    }
}

fn to_unix(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_usage_output() {
        let text = "You are currently using your subscription to power your Claude Code usage\n\
             \n\
             Current session: 8% used · resets Jul 25 at 2pm (America/Chicago)\n\
             Current week (all models): 85% used · resets Jul 28 at 2pm (America/Chicago)\n\
             Current week (Fable): 72% used · resets Jul 28 at 1:59pm (America/Chicago)\n\
             \n\
             What's contributing to your limits usage?\n";

        let windows = parse_claude_windows(text);
        assert_eq!(windows.len(), 3);

        assert_eq!(windows[0].label, "Session");
        assert_eq!(windows[0].used_percent, 8.0);
        assert_eq!(
            windows[0].resets_at_text.as_deref(),
            Some("Jul 25 at 2pm (America/Chicago)")
        );

        assert_eq!(windows[1].label, "Week (all models)");
        assert_eq!(windows[1].used_percent, 85.0);
        assert_eq!(windows[2].label, "Week (Fable)");
    }

    #[test]
    fn ignores_claude_prose_that_isnt_a_limit_line() {
        // Percentages appear all over the "what's contributing" section; only
        // the `Current <window>: N% used` lines are windows.
        let text = "Last 24h · 2413 requests · 18 sessions\n\
             90% of your usage came from subagent-heavy sessions\n\
             Top skills: /design 4%, /simplify 2%\n\
             Current session: 8% used · resets Jul 25 at 2pm\n";

        let windows = parse_claude_windows(text);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].label, "Session");
    }

    #[test]
    fn claude_output_without_limits_yields_nothing() {
        // API-key billing prints no limit lines at all.
        let text = "You are currently using an API key to power your Claude Code usage\n";
        assert!(parse_claude_windows(text).is_empty());
    }

    #[test]
    fn parses_codex_rate_limit_snapshot() {
        let snapshot: Value = serde_json::from_str(
            r#"{
                "limit_id": "codex",
                "primary": {"used_percent": 30.0, "window_minutes": 10080, "resets_at": 1785262985},
                "secondary": null,
                "credits": {"has_credits": false, "balance": "0"},
                "plan_type": "plus"
            }"#,
        )
        .unwrap();

        let usage = build_codex_usage(&snapshot, Some(1785000000));
        assert_eq!(usage.id, "codex");
        assert_eq!(usage.plan.as_deref(), Some("Plus"));
        assert_eq!(usage.observed_at_unix, Some(1785000000));

        assert_eq!(
            usage.windows.len(),
            1,
            "secondary is null and must be skipped"
        );
        assert_eq!(usage.windows[0].label, "Weekly");
        assert_eq!(usage.windows[0].used_percent, 30.0);
        assert_eq!(usage.windows[0].resets_at_unix, Some(1785262985));
    }

    #[test]
    fn parses_codex_snapshot_with_both_windows() {
        let snapshot: Value = serde_json::from_str(
            r#"{
                "primary": {"used_percent": 12.5, "window_minutes": 300, "resets_at": 1785000300},
                "secondary": {"used_percent": 44.0, "window_minutes": 10080, "resets_at": 1785262985}
            }"#,
        )
        .unwrap();

        let usage = build_codex_usage(&snapshot, None);
        assert_eq!(usage.windows.len(), 2);
        assert_eq!(usage.windows[0].label, "Session");
        assert_eq!(usage.windows[0].used_percent, 12.5);
        assert_eq!(usage.windows[1].label, "Weekly");
        assert!(usage.plan.is_none());
    }

    #[test]
    fn finds_rate_limits_nested_in_an_event_envelope() {
        let event: Value = serde_json::from_str(
            r#"{
                "timestamp": "2026-07-25T13:15:31Z",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "rate_limits": {"primary": {"used_percent": 30.0, "window_minutes": 10080}}
                }
            }"#,
        )
        .unwrap();

        let limits = find_rate_limits(&event).expect("should find nested rate_limits");
        assert!(limits.get("primary").is_some());
    }

    #[test]
    fn ignores_events_without_rate_limits() {
        let event: Value =
            serde_json::from_str(r#"{"payload": {"type": "agent_message"}}"#).unwrap();
        assert!(find_rate_limits(&event).is_none());
    }

    #[test]
    fn labels_uncommon_codex_windows_by_duration() {
        assert_eq!(codex_window_label(Some(300)), "Session");
        assert_eq!(codex_window_label(Some(10080)), "Weekly");
        assert_eq!(codex_window_label(Some(1440)), "1d");
        assert_eq!(codex_window_label(Some(180)), "3h");
        assert_eq!(codex_window_label(Some(45)), "45m");
        assert_eq!(codex_window_label(None), "Limit");
    }
}
