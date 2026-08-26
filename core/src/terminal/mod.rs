//! Embedded terminal sessions attached to repo/worktree context.
//!
//! A [`SessionManager`] owns a set of PTY-backed [`Session`]s. Each session runs
//! a shell in a pseudo-terminal, keeps a bounded scrollback [`ring`], and fans
//! raw output out to any number of subscribers. The types in this module form
//! the **canonical wire contract** carried over the daemon protocol to the
//! desktop app — every wire-facing struct serializes as `camelCase` JSON.
//!
//! Each session also runs a VT thread (for on-demand content peek) and a status
//! scanner on its reader thread, which tracks phase from OSC 133 marks, the
//! foreground process, and the title spinner an agent animates while it works.
//!
//! Two features split the module. The wire contract in [`wire`] is always here
//! (`terminal-types`); the PTY machinery below it needs `terminal`. That is what
//! lets the desktop app decode daemon payloads without linking a PTY stack it
//! never uses — the PTYs are the daemon's.

mod wire;

pub use wire::{Phase, SessionStatus, TerminalId, TerminalSummary};

/// The environment variable every session carries its own id in. Set by
/// `Session::spawn` on the daemon side, read by the CLI (`terminal whoami`) on
/// the other — which is how something running inside a session names itself.
///
/// Unconditional, like the wire types: both halves of that contract have to
/// agree on the spelling, and only one of them links a PTY stack.
pub const TERMINAL_ID_ENV: &str = "REVIEW_TERMINAL_ID";

/// Drop `text`'s trailing blank lines in place, leaving no trailing newline.
///
/// The empty rows below the last thing written are padding rather than content,
/// whether they come from a rendered VT grid or from a cooked byte stream.
/// Interior blanks are content and stay. In place and allocation-free because
/// the peek path runs this on the daemon's VT actor thread, behind the
/// desktop's poll.
pub fn trim_trailing_blank_lines(text: &mut String) {
    let mut end = 0;
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        offset += line.len();
        if !line.trim().is_empty() {
            end = offset - usize::from(line.ends_with('\n'));
        }
    }
    text.truncate(end);
}

// Everything below owns or drives real PTYs.
#[cfg(feature = "terminal")]
mod engine_ghostty;
#[cfg(feature = "terminal")]
mod events;
#[cfg(feature = "terminal")]
mod manager;
#[cfg(feature = "terminal")]
mod poll;
#[cfg(feature = "terminal")]
mod ring;
#[cfg(feature = "terminal")]
mod session;
#[cfg(feature = "terminal")]
mod shell_integration;
#[cfg(feature = "terminal")]
mod status;
#[cfg(feature = "terminal")]
mod vt;

// `EventBus` is the manager's own half of the bus and stays inside this module;
// what leaves it is what the daemon's transport needs to carry the events out.
#[cfg(feature = "terminal")]
pub use events::{EventSubscription, SessionEvent, EVENT_CHANNEL_CAPACITY};
#[cfg(feature = "terminal")]
pub use manager::{SessionManager, Subscription, SUBSCRIBER_CHANNEL_CAPACITY};
#[cfg(feature = "terminal")]
pub use session::Session;
#[cfg(feature = "terminal")]
pub use status::StatusScanner;
#[cfg(feature = "terminal")]
pub use vt::{ScreenEngine, VtThread};

#[cfg(feature = "terminal")]
use bytes::Bytes;
#[cfg(feature = "terminal")]
use std::collections::HashMap;
#[cfg(feature = "terminal")]
use std::path::PathBuf;

/// Everything needed to spawn a session. This is the internal Rust spec built by
/// the transport layer from wire request params — not itself a wire type.
#[cfg(feature = "terminal")]
#[derive(Debug, Clone)]
pub struct SessionSpec {
    /// Client-generated session id.
    pub terminal_id: TerminalId,
    /// Repository the session belongs to (used for grouping in `list`).
    pub repo_path: PathBuf,
    /// Workspace the session belongs to, decided by the caller's router. Kept
    /// in memory only; see [`TerminalSummary::workspace_id`].
    pub workspace_id: Option<String>,
    /// Working directory the shell starts in (repo root or a worktree path).
    pub cwd: PathBuf,
    /// Shell to run; falls back to `$SHELL`, then `/bin/zsh`.
    pub shell: Option<PathBuf>,
    pub cols: u16,
    pub rows: u16,
    /// Extra environment variables layered onto the inherited environment.
    pub env: HashMap<String, String>,
}

#[cfg(feature = "terminal")]
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
            workspace_id: None,
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
#[cfg(feature = "terminal")]
pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A message delivered to a session subscriber.
#[cfg(feature = "terminal")]
#[derive(Debug, Clone)]
pub enum TerminalMessage {
    /// Raw bytes read from the PTY, tagged with the scrollback byte cursor
    /// (`seq`) they end at. `Bytes` clones are cheap (refcounted). `seq` is the
    /// ring's cumulative end-offset *after* this chunk, so a reattaching client
    /// can replay scrollback and then drop any live chunk with `seq <= cursor`.
    Output { data: Bytes, seq: u64 },
    /// A status transition.
    Status(SessionStatus),
    /// The PTY was resized. Every attached client shares the one grid, so each
    /// needs to hear when another one changed it — a pane rendering raw PTY
    /// bytes at the wrong width draws garbage, not a smaller screen.
    Resized { cols: u16, rows: u16 },
    /// The child process exited with this code (`None` if unknown).
    Exit(Option<i32>),
}

#[cfg(test)]
mod tests {
    use super::trim_trailing_blank_lines;

    fn trimmed(text: &str) -> String {
        let mut text = text.to_owned();
        trim_trailing_blank_lines(&mut text);
        text
    }

    #[test]
    fn trailing_blank_lines_go_and_interior_ones_stay() {
        assert_eq!(trimmed("a\nb\n\n\n"), "a\nb");
        assert_eq!(trimmed("a\n\nb\n"), "a\n\nb");
        // Whitespace-only rows are padding too.
        assert_eq!(trimmed("a\n   \n\t\n"), "a");
        // Nothing but padding leaves nothing.
        assert_eq!(trimmed("\n  \n\n"), "");
        assert_eq!(trimmed(""), "");
    }

    #[test]
    fn text_without_a_trailing_newline_is_left_alone() {
        assert_eq!(trimmed("a\nb"), "a\nb");
        assert_eq!(trimmed("only"), "only");
    }
}
