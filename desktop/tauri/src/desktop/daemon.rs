//! Lifecycle of the `spur-daemon` process that owns the terminal PTYs.
//!
//! Terminals do not live in this process. A separate `spur-daemon` holds the
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
use spur::daemon::{features, socket_path, DaemonClient, Op, VersionInfo, PROTOCOL_VERSION};
use tauri::{AppHandle, Manager};

/// Where a spawned daemon's stdout/stderr are appended.
const LOG_FILE: &str = "daemon.log";
/// Sidecar binary name (Tauri strips the target triple when bundling).
const BINARY_NAME: &str = "spur-daemon";

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

/// Whether this app is a dev build, which changes attach *policy* (not
/// identity — see `build_identity`, which must stay profile-independent): a
/// dev loop rebuilds the daemon constantly without touching the protocol, and
/// attaching to yesterday's daemon is exactly the stale-code bug the identity
/// check exists to catch. Release builds let the protocol govern instead, so
/// sessions survive app updates.
const DEV_BUILD: bool = cfg!(debug_assertions);

/// The daemon capabilities this app cannot run without.
///
/// **This list, not [`PROTOCOL_VERSION`], is how a breaking change is expressed
/// from v3 on.** Needing something new means adding its feature name here; it
/// must never mean bumping the integer. The integer is a blunt instrument — an
/// app that insists on an exact match makes every older daemon unattachable,
/// and unattachable means *restarted*, which kills every shell the user had
/// running. A name lets an old-but-sufficient daemon keep serving, and only a
/// daemon that genuinely cannot do what this app needs gets replaced.
///
/// Spelled out rather than aliased to [`features::ALL`], because what a daemon
/// *serves* and what this app *requires* are two independent decisions. They
/// happen to coincide today — everything v3 added is load-bearing here: the
/// events channel is the only way sessions started elsewhere appear, and the
/// terminal overview peeks every card in one call — but tying them together
/// would make every future capability, however optional, retroactively
/// mandatory, and so make every daemon predating it unattachable.
const REQUIRED_FEATURES: &[&str] = &[
    features::EVENTS,
    features::PEEK_SCROLLBACK,
    features::PEEK_MANY,
];

/// The first protocol version that reports features at all. Below it a daemon
/// lists nothing, so no requirement can be satisfied and the integer is the
/// whole contract.
const FEATURE_NEGOTIATION_PROTOCOL: u32 = 3;

/// What [`ensure_daemon`] should do about the daemon it just probed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// A daemon is listening and is the exact build we expect — use it as-is.
    Attach,
    /// A daemon is listening and speaks our protocol but is a different build
    /// (the app was updated underneath it). The caller settles it by session
    /// liveness: attach if anything is running — keeping those sessions alive
    /// is the point — else restart it as a free upgrade.
    AttachSkewed,
    /// A daemon is listening but should not be kept: it speaks a different
    /// protocol, or this is a dev build iterating on daemon code. Stop it and
    /// spawn ours; any sessions it had are lost.
    RespawnMismatch,
    /// Nothing is listening. Any socket file left on disk is stale (a crashed
    /// daemon) and is unlinked before spawning.
    SpawnFresh,
}

/// What the version probe learned about whatever is on the socket.
#[derive(Debug, Clone, Copy)]
pub struct Probe {
    /// A daemon answered on the socket.
    pub connect_ok: bool,
    /// It can be driven by this app — see [`protocol_acceptable`]. Not "it is
    /// our exact version": a daemon at an older protocol that still serves
    /// every [`REQUIRED_FEATURES`] name matches too.
    pub protocol_match: bool,
    /// It is byte-for-byte the build we would spawn.
    pub identity_match: bool,
}

/// Whether this app can drive the daemon that answered the version probe.
///
/// Either it is the protocol this build serves — the trivial case — or it is a
/// daemon at [`FEATURE_NEGOTIATION_PROTOCOL`] or above that lists every name in
/// [`REQUIRED_FEATURES`]. The second half is the whole point of the feature
/// vocabulary: a daemon can be several protocol versions behind and still do
/// everything asked of it, and attaching to it keeps its shells alive.
fn protocol_acceptable(version: &VersionInfo) -> bool {
    if version.protocol == Some(PROTOCOL_VERSION) {
        return true;
    }
    version
        .protocol
        .is_some_and(|protocol| protocol >= FEATURE_NEGOTIATION_PROTOCOL)
        && version.has_features(REQUIRED_FEATURES)
}

/// Decide what to do from what the version probe told us.
///
/// Pure so the attach-vs-spawn logic is testable without processes. A leftover
/// socket file is not an input: it cannot change the *action*, it only tells the
/// caller there is a stale entry to unlink before spawning.
pub fn attach_decision(probe: Probe, dev_build: bool) -> Action {
    if !probe.connect_ok {
        return Action::SpawnFresh;
    }
    if !probe.protocol_match {
        return Action::RespawnMismatch;
    }
    if probe.identity_match {
        return Action::Attach;
    }
    // Same protocol, different build. In dev the hash governs — iterating on
    // daemon code must run the new code (see `DEV_BUILD`). In release the
    // protocol governs, and the caller weighs the daemon's sessions.
    if dev_build {
        Action::RespawnMismatch
    } else {
        Action::AttachSkewed
    }
}

/// What a probed daemon speaks, for the log lines that have to explain a
/// respawn. Both halves matter now — the integer alone no longer says whether
/// a daemon is usable — so both are named.
fn describe_protocol(version: Option<&VersionInfo>) -> String {
    let Some(version) = version else {
        return "no version answer".to_owned();
    };
    let protocol = version.describe_protocol();
    if version.features.is_empty() {
        protocol
    } else {
        format!("{protocol} with {}", version.features.join(", "))
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
    // to the previous build's code. Derived from the binary we would spawn; a
    // running daemon reports the identity it captured at its own startup, so a
    // file rebuilt underneath a live daemon reads as a mismatch rather than
    // letting the old process impersonate the new build. Never gate this on the
    // build profile — the app is debug-built while the sidecar is release-built,
    // so the two would disagree forever. See `spur::daemon::build_identity`.
    let expected_identity = resolve_daemon_binary(app).map_or_else(
        |_| app_version.clone(),
        |binary| spur::daemon::build_identity(&app_version, &binary),
    );

    // One probe answers everything: a live daemon replies to `Version`, a
    // crashed one leaves nothing but a socket file behind.
    let existing = DaemonClient::connect(&socket).await.ok();
    let daemon_version = match &existing {
        Some(client) => client.version().await.ok(),
        None => None,
    };
    let decision = attach_decision(
        Probe {
            connect_ok: existing.is_some(),
            protocol_match: daemon_version.as_ref().is_some_and(protocol_acceptable),
            identity_match: daemon_version
                .as_ref()
                .is_some_and(|v| v.identity == expected_identity),
        },
        DEV_BUILD,
    );
    let daemon_identity = daemon_version
        .as_ref()
        .map_or("unknown", |v| v.identity.as_str());

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
        Action::AttachSkewed => {
            let client = existing.ok_or_else(|| anyhow!("attach without a live connection"))?;
            // The one place session liveness matters: a busy daemon is kept for
            // its sessions, an idle one restarts as a free upgrade. A probe
            // that fails reads as busy — never kill what we cannot see.
            if client
                .attributions()
                .await
                .map_or(true, |sessions| !sessions.is_empty())
            {
                info!(
                    "[daemon] attached to daemon {daemon_identity} (this app expects {expected_identity}) — \
                     it serves {} and has live sessions, so they survive the update; \
                     it upgrades on a later launch once idle",
                    describe_protocol(daemon_version.as_ref()),
                );
                Ok(client)
            } else {
                info!(
                    "[daemon] daemon {daemon_identity} is outdated but idle — upgrading it to {expected_identity}",
                );
                stop_daemon(client, &socket).await;
                spawn_and_connect(app, &socket, t0).await
            }
        }
        Action::RespawnMismatch => {
            warn!(
                "[daemon] running daemon is {daemon_identity} ({}) but this app expects \
                 {expected_identity} (protocol {PROTOCOL_VERSION}, or {FEATURE_NEGOTIATION_PROTOCOL}+ \
                 serving {}) — restarting it (any sessions it had are lost)",
                describe_protocol(daemon_version.as_ref()),
                REQUIRED_FEATURES.join(", "),
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
    let pid_file = spur::daemon::pid_path(socket);
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

/// Start a detached `spur-daemon`.
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
        command.env("SPUR_HOME", home);
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

/// Locate the `spur-daemon` binary, preferring the bundled sidecar.
fn resolve_daemon_binary(app: &AppHandle) -> Result<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. Production bundle: the sidecar sits next to the main binary, at
    //    Spur.app/Contents/MacOS/spur-daemon (resource_dir is
    //    Contents/Resources). Same shape `install_cli` uses for spur-cli.
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

    /// A version answer, as the probe would have decoded it.
    fn version(protocol: Option<u32>, features: &[&str]) -> VersionInfo {
        VersionInfo {
            identity: "0.0.1+deadbeefdeadbeef".to_owned(),
            protocol,
            features: features.iter().map(|f| (*f).to_owned()).collect(),
        }
    }

    /// The feature half of the attach rule, which is the whole reason the
    /// integer stopped governing: a daemon behind this build's protocol but
    /// serving everything asked of it is attached to, and its shells live.
    #[test]
    fn a_daemon_matches_by_features_not_only_by_version() {
        assert!(
            protocol_acceptable(&version(Some(PROTOCOL_VERSION), &[])),
            "our own protocol is accepted whatever it lists — the trivial case, \
             and the one that must not depend on a feature name existing yet"
        );
        assert!(
            protocol_acceptable(&version(Some(PROTOCOL_VERSION + 7), REQUIRED_FEATURES)),
            "a daemon several bumps ahead still serves what we need"
        );
        assert!(
            !protocol_acceptable(&version(Some(PROTOCOL_VERSION + 7), &[])),
            "…but a newer integer alone promises nothing: no names, no attach"
        );
        assert!(
            !protocol_acceptable(&version(
                Some(FEATURE_NEGOTIATION_PROTOCOL - 1),
                REQUIRED_FEATURES
            )),
            "below feature negotiation the names are not a contract, however \
             they got into the payload"
        );
        assert!(
            !protocol_acceptable(&version(None, REQUIRED_FEATURES)),
            "a daemon from before the protocol was versioned is a mismatch"
        );
    }

    /// Missing *one* required name is a mismatch. The point of naming
    /// capabilities is that this is the failure mode a future breaking change
    /// takes — never a version bump that would strand every older daemon.
    ///
    /// Probed at a protocol other than our own, since our own is accepted
    /// outright: a daemon built from this same source serves what this build
    /// serves, and making the app interrogate itself would only mean the day a
    /// feature is added is the day the app cannot attach to its own daemon.
    #[test]
    fn one_missing_feature_is_enough_to_respawn() {
        for dropped in REQUIRED_FEATURES {
            let served: Vec<&str> = REQUIRED_FEATURES
                .iter()
                .copied()
                .filter(|name| name != dropped)
                .collect();
            assert!(
                !protocol_acceptable(&version(Some(PROTOCOL_VERSION + 1), &served)),
                "a daemon that cannot do {dropped} cannot be driven by this app"
            );
        }
    }

    /// The whole policy as one table: (connect_ok, protocol_match,
    /// identity_match, dev_build) → action, with the rationale as the failure
    /// message. `AttachSkewed` is deliberately a *release-only* answer — the
    /// caller then keeps a busy daemon or restarts an idle one as a free
    /// upgrade; that half is effectful and lives in `ensure_daemon`.
    #[test]
    fn the_attach_decision_table_holds() {
        #[rustfmt::skip]
        let table = [
            (true, true, true, false, Action::Attach,
             "the exact expected build is attached to"),
            (true, true, true, true, Action::Attach,
             "the exact expected build is attached to, in dev too"),
            (true, false, false, false, Action::RespawnMismatch,
             "a daemon missing the protocol or a required feature cannot be driven at all"),
            (true, false, false, true, Action::RespawnMismatch,
             "a daemon missing the protocol or a required feature cannot be driven, in dev too"),
            (true, true, false, true, Action::RespawnMismatch,
             "in dev the hash governs: a rebuilt daemon must run its new code \
              (the live stale-daemon bug of 2026-08-14)"),
            (true, true, false, false, Action::AttachSkewed,
             "in release the wire governs: an app update must not kill the \
              sessions of a daemon it can still drive"),
            (false, false, false, false, Action::SpawnFresh,
             "nothing listening spawns fresh"),
            (false, true, true, true, Action::SpawnFresh,
             "nothing listening spawns fresh — no other flag can matter"),
        ];
        for (connect_ok, protocol_match, identity_match, dev_build, expected, why) in table {
            assert_eq!(
                attach_decision(
                    Probe {
                        connect_ok,
                        protocol_match,
                        identity_match,
                    },
                    dev_build,
                ),
                expected,
                "{why}"
            );
        }
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
