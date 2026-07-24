//! The terminal session daemon: PTYs that outlive the desktop app.
//!
//! A `review-daemon` process owns the one [`SessionManager`] and serves it over
//! a `0600` Unix socket at [`socket_path`] (`~/.review/daemon.sock`, respecting
//! `$REVIEW_HOME`). The desktop app attaches to that socket instead of embedding
//! the manager, so quitting — or crashing — the app leaves running shells alone.
//!
//! Two features split the crate's two halves:
//! - `daemon` (implies `terminal`) — the [`serve`] side, i.e. the binary.
//! - `daemon-client` — [`DaemonClient`], with no PTY dependencies at all.
//!
//! [`protocol`] and [`codec`] are shared by both. See [`protocol`] for the wire
//! contract.
//!
//! [`SessionManager`]: crate::terminal::SessionManager

pub mod codec;
pub mod protocol;

use std::path::{Path, PathBuf};

/// Name of the Unix socket the daemon listens on, inside the review home.
const SOCKET_FILE: &str = "daemon.sock";

/// Name of the pid file written beside the socket, so a supervisor (or a
/// stale-socket cleanup path) can identify the owning process.
const PID_FILE: &str = "daemon.pid";

/// The socket the daemon listens on: `daemon.sock` inside the review home
/// (`~/.review`, or `$REVIEW_HOME`).
///
/// Daemon and client live in different *processes*, so nothing but this function
/// keeps them pointed at the same file: the binary binds what this returns and
/// every client connects to it. Never rebuild the path by hand.
pub fn socket_path() -> anyhow::Result<PathBuf> {
    Ok(crate::review::central::get_central_root()?.join(SOCKET_FILE))
}

/// The pid file that sits beside `socket`.
pub fn pid_path(socket: &Path) -> PathBuf {
    socket.with_file_name(PID_FILE)
}

/// Identity of the daemon *code* a client should be talking to: the package
/// version plus a hash of the binary itself.
///
/// The app compares the identity it expects against the one a running daemon
/// reports, and respawns on a mismatch. The version alone is not enough:
/// iterating on the daemon rebuilds the binary without ever changing the
/// version, so a version-only check would happily attach to a daemon still
/// running the *previous* build's code — new code would silently never run.
/// Hashing makes changed code look like a new build (respawn), while an
/// unchanged binary keeps its identity (attach, so sessions survive an app
/// restart). In a release build an update replaces the binary, so version and
/// hash both change and old sessions are dropped, exactly as intended.
///
/// Two properties this deliberately relies on:
///
/// - It hashes *contents*, not mtime. `scripts/build-daemon-sidecar` re-copies
///   the binary on every `scripts/dev`, bumping mtime without changing a byte;
///   an mtime stamp would respawn the daemon — killing every session — on every
///   dev restart.
/// - It is **not** gated on `cfg!(debug_assertions)`. The daemon and the app are
///   built with different profiles (in dev the app is a debug build while the
///   sidecar daemon is built `--release`), so anything profile-dependent would
///   make the two sides disagree permanently and respawn on every launch.
///
/// Both sides derive this from the same file — the daemon from its own
/// executable, the app from the binary it resolved — so they agree without
/// exchanging anything but the string.
pub fn build_identity(version: &str, binary: &Path) -> String {
    // Short hash: this only has to distinguish builds, not resist attack.
    let digest = std::fs::read(binary).map_or_else(
        |_| "unreadable".to_owned(),
        |bytes| {
            use sha2::{Digest, Sha256};
            let hash = Sha256::digest(&bytes);
            hex::encode(&hash[..8])
        },
    );
    format!("{version}+{digest}")
}

#[cfg(feature = "daemon-client")]
mod client;
#[cfg(feature = "daemon")]
mod server;

pub use protocol::{Hello, Op, OpResult, ReplayPayload, Request, Response, StreamFrame};

#[cfg(feature = "daemon-client")]
pub use client::{DaemonClient, StreamHandle};
#[cfg(feature = "daemon")]
pub use server::serve;

#[cfg(test)]
mod tests {
    use super::*;

    // That the identity does not depend on the build profile cannot be tested
    // here: a unit test in this crate only ever runs in one profile, so it would
    // pass even if `build_identity` were `cfg!`-gated. The real coverage is
    // `a_release_built_daemon_reports_the_identity_we_expect` in `server.rs`,
    // which runs the release-built sidecar and compares what it reports against
    // what this debug-built caller computes for the same file.

    /// Changed code must look like a new build — otherwise the app attaches to a
    /// daemon running stale code.
    #[test]
    fn changed_code_changes_its_identity() {
        let dir = tempfile::TempDir::new().unwrap();
        let binary = dir.path().join("review-daemon");
        std::fs::write(&binary, b"v1").unwrap();
        let first = build_identity("0.0.123", &binary);

        std::fs::write(&binary, b"v2").unwrap();
        let second = build_identity("0.0.123", &binary);

        assert!(first.starts_with("0.0.123"));
        assert!(second.starts_with("0.0.123"));
        assert_ne!(first, second, "changed code must force a respawn");
    }

    /// The dev loop re-copies the daemon binary on every `scripts/dev`, bumping
    /// its mtime without changing a byte. That must NOT count as a new build, or
    /// every dev restart would kill every running session.
    #[test]
    fn recopying_an_unchanged_binary_keeps_its_identity() {
        let dir = tempfile::TempDir::new().unwrap();
        let binary = dir.path().join("review-daemon");
        std::fs::write(&binary, b"same bytes").unwrap();
        let before = build_identity("0.0.123", &binary);

        // Simulate the sidecar copy: identical contents, fresh mtime.
        std::fs::remove_file(&binary).unwrap();
        std::fs::write(&binary, b"same bytes").unwrap();
        let after = build_identity("0.0.123", &binary);

        assert_eq!(
            before, after,
            "an unchanged binary must keep its identity so sessions survive"
        );
    }

    /// A missing binary must not panic — the caller falls back to the version.
    #[test]
    fn an_unreadable_binary_still_yields_an_identity() {
        let identity = build_identity("0.0.123", Path::new("/nonexistent/review-daemon"));
        assert!(identity.starts_with("0.0.123"));
    }
}
