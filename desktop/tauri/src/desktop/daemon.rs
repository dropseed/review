//! Lifecycle of the `review-daemon` process that owns the terminal PTYs.
//!
//! Terminals do not live in this process. A separate `review-daemon` holds the
//! one `SessionManager` and serves it over a `0600` Unix socket, so quitting —
//! or crashing — the desktop app leaves running shells alone. Everything here is
//! about *finding* that daemon: attach to a live one, respawn it when the app
//! has been updated underneath it, or spawn a fresh one.
//!
//! The daemon is deliberately **detached**: spawned into its own process group
//! with `kill_on_drop(false)`, so it outlives the app that started it. That is
//! the opposite of the LSP servers in [`super::commands`], which die with us.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use log::{error, info, warn};
use review::daemon::{socket_path, DaemonClient, Op};
use tauri::{AppHandle, Manager};

/// Where a spawned daemon's stdout/stderr are appended.
const LOG_FILE: &str = "daemon.log";
/// Sidecar binary name (Tauri strips the target triple when bundling).
const BINARY_NAME: &str = "review-daemon";

/// How long to keep retrying the first connect to a daemon we just spawned.
const SPAWN_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// How long to wait for a daemon asked to quit to stop accepting connections.
const QUIT_TIMEOUT: Duration = Duration::from_secs(3);
/// First gap between connect attempts while polling for a socket to come up or
/// go down. The daemon binds a few milliseconds after being spawned, so the
/// first retry is always the interesting one: waiting a full ceiling there
/// would spend more time asleep than the daemon spends starting.
const POLL_INTERVAL_MIN: Duration = Duration::from_millis(2);
/// Ceiling the poll gap doubles up to, so a genuinely slow start (a cold binary
/// Gatekeeper is still verifying) polls a handful of times per second instead of
/// spinning. The overall budgets above are unchanged.
const POLL_INTERVAL_MAX: Duration = Duration::from_millis(25);

/// What [`ensure_daemon`] should do about the daemon it just probed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// A daemon is listening and speaks our version — use it as-is.
    Attach,
    /// A daemon is listening but is a different build — stop it and spawn ours.
    /// Its sessions are lost; that is the accepted cost of an app update.
    RespawnMismatch,
    /// Nothing is listening. Any socket file left on disk is stale (a crashed
    /// daemon) and is unlinked before spawning.
    SpawnFresh,
}

/// Decide what to do from what the version probe told us.
///
/// Pure so the attach-vs-spawn logic is testable without processes. A leftover
/// socket file is not an input: it cannot change the *action*, it only tells the
/// caller there is a stale entry to unlink before spawning.
pub fn attach_decision(connect_ok: bool, version_match: bool) -> Action {
    match (connect_ok, version_match) {
        (true, true) => Action::Attach,
        (true, false) => Action::RespawnMismatch,
        (false, _) => Action::SpawnFresh,
    }
}

/// Connect to the terminal daemon, spawning or restarting it if needed.
///
/// Streams open their own connections to the same socket — [`socket_path`] is
/// the one definition of it, shared with the daemon binary itself, so nothing
/// here rebuilds that path by hand.
///
/// Must be called *after* `fix_path_env::fix()`: the daemon inherits this
/// process's environment, and every shell it later spawns inherits that in turn,
/// so a GUI launch would otherwise hand every terminal a minimal macOS `PATH`.
pub async fn ensure_daemon(app: &AppHandle) -> Result<DaemonClient> {
    let t0 = Instant::now();
    let socket = socket_path().map_err(|e| anyhow!("resolving the review home: {e}"))?;
    let app_version = app.package_info().version.to_string();

    // What the daemon *should* be running: the version plus a fingerprint of the
    // binary, so a rebuilt daemon forces a respawn instead of the app attaching
    // to the previous build's code. Derived from the binary we would spawn,
    // which is the same file a running daemon reports on. Never gate this on the
    // build profile — the app is debug-built while the sidecar is release-built,
    // so the two would disagree forever. See `review::daemon::build_identity`.
    let expected_identity = resolve_daemon_binary(app).map_or_else(
        |_| app_version.clone(),
        |binary| review::daemon::build_identity(&app_version, &binary),
    );

    // One probe answers everything: a live daemon replies to `Version`, a
    // crashed one leaves nothing but a socket file behind.
    let existing = DaemonClient::connect(&socket).await.ok();
    let daemon_version = match &existing {
        Some(client) => client.version().await.ok(),
        None => None,
    };

    let decision = attach_decision(
        existing.is_some(),
        daemon_version.as_deref() == Some(expected_identity.as_str()),
    );

    match decision {
        Action::Attach => {
            let client = existing.ok_or_else(|| anyhow!("attach without a live connection"))?;
            info!(
                "[daemon] attached to running daemon v{app_version} at {} in {:?}",
                socket.display(),
                t0.elapsed()
            );
            Ok(client)
        }
        Action::RespawnMismatch => {
            warn!(
                "[daemon] running daemon is v{} but this app is v{app_version} — restarting it (its sessions are lost)",
                daemon_version.as_deref().unwrap_or("unknown"),
            );
            let client = existing.ok_or_else(|| anyhow!("respawn without a live connection"))?;
            stop_daemon(client, &socket).await;
            spawn_and_connect(app, &socket, t0).await
        }
        Action::SpawnFresh => {
            if socket.exists() {
                info!(
                    "[daemon] unlinking stale socket {} (no daemon is listening)",
                    socket.display()
                );
                if let Err(e) = std::fs::remove_file(&socket) {
                    warn!("[daemon] could not remove stale socket: {e}");
                }
            }
            spawn_and_connect(app, &socket, t0).await
        }
    }
}

/// Spawn a daemon and wait for it to start accepting.
async fn spawn_and_connect(app: &AppHandle, socket: &Path, t0: Instant) -> Result<DaemonClient> {
    spawn_daemon(app, socket)?;
    let client = connect_with_retry(socket, SPAWN_CONNECT_TIMEOUT).await?;
    info!(
        "[daemon] spawned daemon on {} in {:?}",
        socket.display(),
        t0.elapsed()
    );
    Ok(client)
}

/// Ask a daemon to quit and wait for its socket to go quiet, escalating to
/// SIGTERM by pid file if it does not.
///
/// Best-effort throughout: every failure here just means we fall through to the
/// next, blunter step, and the caller unlinks the socket before rebinding.
async fn stop_daemon(client: DaemonClient, socket: &Path) {
    // The daemon shuts down all sessions and exits; it may drop the connection
    // before answering, which is not an error worth reporting.
    let _ = client.request(Op::Quit).await;
    drop(client);

    if wait_until_socket_dead(socket, QUIT_TIMEOUT).await {
        return;
    }

    warn!("[daemon] daemon did not exit after quit; sending SIGTERM");
    sigterm_from_pid_file(socket).await;
    if !wait_until_socket_dead(socket, QUIT_TIMEOUT).await {
        error!(
            "[daemon] daemon at {} is still listening; the new one will fail to bind",
            socket.display()
        );
    }
    let _ = std::fs::remove_file(socket);
}

/// SIGTERM whoever the pid file names.
///
/// Shelling out to `/bin/kill` rather than `libc::kill`: the workspace denies
/// `unsafe_code`, and this path runs at most once per app update.
async fn sigterm_from_pid_file(socket: &Path) {
    let pid_file = review::daemon::pid_path(socket);
    let Ok(contents) = std::fs::read_to_string(&pid_file) else {
        return;
    };
    let Ok(pid) = contents.trim().parse::<u32>() else {
        warn!("[daemon] {} does not contain a pid", pid_file.display());
        return;
    };
    let killed = tokio::process::Command::new("/bin/kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
    if let Err(e) = killed {
        warn!("[daemon] could not signal pid {pid}: {e}");
    }
}

/// Poll until nothing accepts on `socket`, or `timeout` elapses. `true` if the
/// socket went quiet.
async fn wait_until_socket_dead(socket: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let mut gap = POLL_INTERVAL_MIN;
    loop {
        if tokio::net::UnixStream::connect(socket).await.is_err() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(gap).await;
        gap = next_poll_gap(gap);
    }
}

/// Poll until the daemon accepts a control connection, or `timeout` elapses.
async fn connect_with_retry(socket: &Path, timeout: Duration) -> Result<DaemonClient> {
    let deadline = Instant::now() + timeout;
    let mut gap = POLL_INTERVAL_MIN;
    loop {
        let error = match DaemonClient::connect(socket).await {
            Ok(client) => return Ok(client),
            Err(e) => e,
        };
        if Instant::now() >= deadline {
            return Err(error.context(format!(
                "daemon did not start listening on {} within {timeout:?}",
                socket.display()
            )));
        }
        tokio::time::sleep(gap).await;
        gap = next_poll_gap(gap);
    }
}

/// Back off one step: double the gap, but never past the ceiling.
fn next_poll_gap(gap: Duration) -> Duration {
    (gap * 2).min(POLL_INTERVAL_MAX)
}

/// Start a detached `review-daemon`.
///
/// Two deliberate departures from how this app spawns anything else:
/// `process_group(0)` puts the daemon in its own group, so a signal aimed at the
/// app's group never reaches it, and `kill_on_drop(false)` (Tokio's default,
/// stated explicitly because it is the whole point) means dropping the handle
/// leaves it running. The daemon is *supposed* to outlive us.
fn spawn_daemon(app: &AppHandle, socket: &Path) -> Result<()> {
    let binary = resolve_daemon_binary(app)?;
    let log_path = socket.with_file_name(LOG_FILE);
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let log_err = log.try_clone()?;

    let mut command = tokio::process::Command::new(&binary);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .process_group(0)
        .kill_on_drop(false);

    // Pin the daemon to the same review home this socket path came from, so the
    // two processes can never disagree about which socket file to use. The rest
    // of the environment is inherited — that is what carries the `PATH` that
    // `fix_path_env` repaired for GUI launches, on to every shell the daemon
    // spawns. The daemon's logger is opt-in via `RUST_LOG`, so default it to
    // something that makes daemon.log worth having.
    if let Some(home) = socket.parent() {
        command.env("REVIEW_HOME", home);
    }
    if std::env::var_os("RUST_LOG").is_none() {
        command.env("RUST_LOG", "info");
    }

    let mut child = command
        .spawn()
        .map_err(|e| anyhow!("spawning {}: {e}", binary.display()))?;
    let pid = child.id();
    info!(
        "[daemon] spawned {} (pid {:?}), logging to {}",
        binary.display(),
        pid,
        log_path.display()
    );

    // Reap the child so it does not linger as a zombie while the app runs. This
    // task only observes — `kill_on_drop(false)` means aborting it (at app exit)
    // leaves the daemon alive, reparented to init.
    tokio::spawn(async move {
        match child.wait().await {
            Ok(status) => warn!("[daemon] daemon exited early with {status}"),
            Err(e) => warn!("[daemon] could not wait on daemon: {e}"),
        }
    });

    Ok(())
}

/// Locate the `review-daemon` binary, preferring the bundled sidecar.
fn resolve_daemon_binary(app: &AppHandle) -> Result<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Production bundle: the sidecar sits next to the main binary, at
    //    Review.app/Contents/MacOS/review-daemon (resource_dir is
    //    Contents/Resources). Same shape `install_cli` uses for review-cli.
    if let Ok(resources) = app.path().resource_dir() {
        if let Some(contents) = resources.parent() {
            candidates.push(contents.join("MacOS").join(BINARY_NAME));
        }
    }

    // 2. Beside the running executable — where `tauri dev` stages sidecars, and
    //    where non-macOS bundles put them.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(BINARY_NAME));
        }
    }

    // 3. Dev checkout: the triple-suffixed artifact scripts/build-daemon-sidecar
    //    writes, resolved against this crate's source directory.
    if let Ok(triple) = tauri::utils::platform::target_triple() {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("{BINARY_NAME}-{triple}")),
        );
    }

    for candidate in &candidates {
        if candidate.is_file() {
            return Ok(candidate.clone());
        }
    }

    Err(anyhow!(
        "could not find the {BINARY_NAME} binary; tried: {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_live_daemon_on_our_version_is_attached_to() {
        assert_eq!(attach_decision(true, true), Action::Attach);
    }

    #[test]
    fn a_live_daemon_on_another_version_is_respawned() {
        assert_eq!(attach_decision(true, false), Action::RespawnMismatch);
    }

    #[test]
    fn nothing_listening_spawns_fresh() {
        // Nothing answered — whether a crashed daemon left a socket file behind
        // or not, and a version can never match, but the decision must not
        // depend on that.
        assert_eq!(attach_decision(false, false), Action::SpawnFresh);
        assert_eq!(attach_decision(false, true), Action::SpawnFresh);
    }

    /// The gap must start well under a daemon's ~5-15ms startup and stop at the
    /// ceiling, so a slow start polls steadily instead of spinning.
    #[test]
    fn the_poll_gap_doubles_up_to_the_ceiling() {
        assert!(POLL_INTERVAL_MIN < POLL_INTERVAL_MAX);
        assert_eq!(next_poll_gap(POLL_INTERVAL_MIN), POLL_INTERVAL_MIN * 2);
        assert_eq!(next_poll_gap(POLL_INTERVAL_MAX), POLL_INTERVAL_MAX);
        assert_eq!(
            next_poll_gap(POLL_INTERVAL_MAX / 2 + Duration::from_millis(1)),
            POLL_INTERVAL_MAX
        );
    }
}
