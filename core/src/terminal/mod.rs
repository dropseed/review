//! Embedded terminal sessions attached to repo/worktree context.
//!
//! A [`SessionManager`] owns a set of PTY-backed [`Session`]s. Each session runs
//! a shell in a pseudo-terminal, keeps a bounded scrollback [`ring`], and fans
//! raw output out to any number of subscribers. The types in this module form
//! the **canonical wire contract** shared by the Tauri desktop and Axum web
//! transports — every wire-facing struct serializes as `camelCase` JSON.
//!
//! Each session also runs a VT thread (for on-demand content peek) and a status
//! scanner (OSC 133 / foreground-process phase tracking) on its reader thread.

mod engine_alacritty;
mod manager;
mod poll;
mod ring;
mod session;
mod shell_integration;
mod status;
mod vt;

pub use manager::{SessionManager, Subscription, SUBSCRIBER_CHANNEL_CAPACITY};
pub use session::Session;
pub use status::StatusScanner;
pub use vt::{ScreenEngine, VtThread};

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Client-generated identifier for a terminal session (a `crypto.randomUUID()`
/// string on the frontend). Serializes transparently as its inner string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TerminalId(pub String);

impl std::fmt::Display for TerminalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for TerminalId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for TerminalId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

/// Everything needed to spawn a session. This is the internal Rust spec built by
/// the transport layer from wire request params — not itself a wire type.
#[derive(Debug, Clone)]
pub struct SessionSpec {
    /// Client-generated session id.
    pub terminal_id: TerminalId,
    /// Repository the session belongs to (used for grouping in `list`).
    pub repo_path: PathBuf,
    /// Working directory the shell starts in (repo root or a worktree path).
    pub cwd: PathBuf,
    /// Shell to run; falls back to `$SHELL`, then `/bin/zsh`.
    pub shell: Option<PathBuf>,
    pub cols: u16,
    pub rows: u16,
    /// Extra environment variables layered onto the inherited environment.
    pub env: HashMap<String, String>,
}

impl SessionSpec {
    /// Create a spec with a default 80x24 size, no shell override, and no extra
    /// environment. Fields are public, so callers can adjust after construction.
    pub fn new(
        terminal_id: impl Into<TerminalId>,
        repo_path: impl Into<PathBuf>,
        cwd: impl Into<PathBuf>,
    ) -> Self {
        Self {
            terminal_id: terminal_id.into(),
            repo_path: repo_path.into(),
            cwd: cwd.into(),
            shell: None,
            cols: 80,
            rows: 24,
            env: HashMap::new(),
        }
    }
}

/// Current time in epoch milliseconds. Shared by the session lifecycle and the
/// status engine so every `enteredStateAt` stamp uses one clock.
pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Coarse lifecycle/interaction state of a session, shown in the sidebar.
///
/// Only the exit-driven transition to [`Phase::Idle`] is set in this phase; the
/// live phase machine (OSC 133 / foreground-process polling) arrives later.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// A command is actively running.
    Working,
    /// The shell is at a prompt, waiting for the user to type.
    WaitingForInput,
    /// Something rang the bell / needs the user's attention.
    NeedsAttention,
    /// No command running and nothing pending.
    Idle,
}

/// The full status of a session — the canonical `TerminalStatus` wire shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub id: TerminalId,
    pub phase: Phase,
    /// Command currently running, if known.
    pub running_command: Option<String>,
    /// Exit code of the last completed command (or the shell itself).
    pub last_exit_code: Option<i32>,
    /// Current working directory, if known.
    pub cwd: Option<String>,
    /// Terminal title (OSC 0/2), if set.
    pub title: Option<String>,
    /// When the session entered its current [`Phase`], in epoch milliseconds.
    pub entered_state_at: u64,
    /// Whether shell integration (OSC 133 marks) is active.
    pub shell_integration_active: bool,
}

/// Summary of a session — the canonical `TerminalSessionInfo` wire shape.
/// Returned by `start` and `list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSummary {
    pub id: TerminalId,
    pub repo_path: String,
    pub cwd: String,
    pub title: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub status: SessionStatus,
}

/// A message delivered to a session subscriber.
#[derive(Debug, Clone)]
pub enum TerminalMessage {
    /// Raw bytes read from the PTY, tagged with the scrollback byte cursor
    /// (`seq`) they end at. `Bytes` clones are cheap (refcounted). `seq` is the
    /// ring's cumulative end-offset *after* this chunk, so a reattaching client
    /// can replay scrollback and then drop any live chunk with `seq <= cursor`.
    Output { data: Bytes, seq: u64 },
    /// A status transition.
    Status(SessionStatus),
    /// The child process exited with this code (`None` if unknown).
    Exit(Option<i32>),
}
