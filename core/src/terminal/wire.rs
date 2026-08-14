//! The terminal wire contract: the types that cross the daemon protocol.
//!
//! Plain serde structs with no PTY dependencies, so a process that only decodes
//! daemon payloads — the desktop app — gets them from the `terminal-types`
//! feature without compiling `portable-pty`, `vte`, `nix` or `libghostty-vt`
//! (and so without needing a Zig toolchain). Every struct here serializes as
//! `camelCase` JSON.

use serde::{Deserialize, Serialize};

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
    /// Something rang the bell or sent a desktop-notification escape and needs
    /// the user's attention.
    NeedsAttention,
    /// No command running and nothing pending.
    Idle,
}

/// The serde wire names (`working`, `waiting_for_input`, …), so human-facing
/// output agrees with JSON payloads instead of inventing a second spelling.
impl std::fmt::Display for Phase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Phase::Working => "working",
            Phase::WaitingForInput => "waiting_for_input",
            Phase::NeedsAttention => "needs_attention",
            Phase::Idle => "idle",
        })
    }
}

/// The full status of a session — the canonical `TerminalStatus` wire shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub id: TerminalId,
    pub phase: Phase,
    /// Text of the notification (OSC 9 / OSC 777) that raised the
    /// needs-attention overlay, if any. Cleared when the overlay clears.
    pub attention_message: Option<String>,
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
    /// The workspace this session belongs to, as decided by whoever started it.
    /// Runtime-only attribution: the daemon carries the id and never persists
    /// it, so a session that outlives a restart comes back unattributed and is
    /// re-routed rather than pointing at a workspace that may be gone.
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub cwd: String,
    pub title: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub status: SessionStatus,
}
