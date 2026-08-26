//! The daemon side of the Unix-socket terminal protocol.
//!
//! One process owns a single [`SessionManager`] and serves it over a `0600`
//! Unix socket, so PTYs outlive the desktop app that started them. This is the
//! only transport for terminals: blocking manager calls hop to `spawn_blocking`,
//! stream connections drop the subscription's replay bytes (scrollback is
//! fetched separately via [`Op::Replay`]), and a stream that falls behind
//! re-subscribes instead of dying.
//!
//! **Closing a connection never kills a session.** Only [`Op::Kill`],
//! [`Op::ShutdownAllSessions`], [`Op::Quit`], and process shutdown do.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use base64::Engine as _;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::OwnedWriteHalf;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{Mutex, Notify};

use super::codec::{read_frame, write_frame};
use super::pid_path;
use super::protocol::{
    encode_output_framed, features, Event, Hello, Op, OpResult, ReplayPayload, Request, Response,
    StreamFrame, VersionInfo, B64, PROTOCOL_VERSION,
};
use crate::terminal::{
    SessionEvent, SessionManager, SessionSpec, Subscription, TerminalId, TerminalMessage,
};

/// Serve terminal sessions on `socket` until Ctrl-C, SIGTERM, or [`Op::Quit`].
///
/// Errors if another daemon is already listening on the same path.
/// The identity this daemon *started* as, captured before the first connection.
///
/// `Op::Version` must report the running code's identity, not a fresh hash of
/// the file at our path: cargo rebuilds that file underneath a live daemon, so
/// a lazily-computed hash makes an outdated daemon impersonate the new build
/// and silently defeats the version-mismatch respawn — in exactly the
/// rebuild-heavy dev workflow the check exists for.
static STARTUP_IDENTITY: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn startup_identity() -> &'static str {
    STARTUP_IDENTITY.get_or_init(|| {
        std::env::current_exe().map_or_else(
            |_| env!("CARGO_PKG_VERSION").to_owned(),
            |exe| super::build_identity(env!("CARGO_PKG_VERSION"), &exe),
        )
    })
}

pub async fn serve(socket: PathBuf) -> Result<()> {
    // Capture the identity now, while the file on disk is still the code that
    // is running — see `STARTUP_IDENTITY`.
    let _ = startup_identity();
    let listener = bind(&socket)?;
    let pid_path = pid_path(&socket);
    if let Err(e) = std::fs::write(&pid_path, std::process::id().to_string()) {
        log::warn!("[daemon] could not write {}: {e}", pid_path.display());
    }
    log::info!("[daemon] listening on {}", socket.display());

    let manager = Arc::new(SessionManager::new());
    let quit = Arc::new(Notify::new());

    let shutdown = crate::signal::shutdown_signal();
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, _addr)) => {
                    let manager = Arc::clone(&manager);
                    let quit = Arc::clone(&quit);
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, manager, quit).await {
                            log::debug!("[daemon] connection ended: {e}");
                        }
                    });
                }
                Err(e) => log::warn!("[daemon] accept failed: {e}"),
            },
            () = &mut shutdown => {
                log::info!("[daemon] shutdown signal received");
                break;
            }
            () = quit.notified() => {
                log::info!("[daemon] quit requested");
                break;
            }
        }
    }

    // Kill every child explicitly on every death path — nothing else reaps them.
    // See [`SessionManager::shutdown_all`]. (`Op::Quit` already did this; the
    // second call just drains an empty map.)
    manager.shutdown_all();

    let _ = std::fs::remove_file(&pid_path);
    let _ = std::fs::remove_file(&socket);
    Ok(())
}

/// Create the socket's parent directory, refuse to steal a live daemon's socket,
/// clear a stale one, bind, and lock the socket down to the owning user.
fn bind(socket: &Path) -> Result<UnixListener> {
    if let Some(parent) = socket.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    if socket.exists() {
        // A successful connect means somebody is listening — never unlink that.
        if std::os::unix::net::UnixStream::connect(socket).is_ok() {
            bail!("a daemon is already listening on {}", socket.display());
        }
        std::fs::remove_file(socket)
            .with_context(|| format!("removing stale socket {}", socket.display()))?;
    }

    let listener =
        UnixListener::bind(socket).with_context(|| format!("binding {}", socket.display()))?;
    // Any same-uid process can still reach the socket; this keeps *other* users
    // out. See the plan's trust-boundary note.
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))
        .with_context(|| format!("chmod 0600 {}", socket.display()))?;
    Ok(listener)
}

// ============================================================
// Connection dispatch
// ============================================================

/// Read the hello frame and hand the connection to the right role.
async fn handle_connection(
    stream: UnixStream,
    manager: Arc<SessionManager>,
    quit: Arc<Notify>,
) -> Result<()> {
    let (mut reader, writer) = stream.into_split();
    let hello = read_frame(&mut reader)
        .await?
        .context("connection closed before the hello frame")?;
    let hello: Hello = serde_json::from_slice(&hello).context("malformed hello frame")?;

    match hello {
        Hello::Control => serve_control(reader, writer, manager, quit).await,
        Hello::Stream { terminal_id } => {
            serve_stream(reader, writer, manager, TerminalId::from(terminal_id)).await
        }
        Hello::Events => serve_events(reader, writer, manager).await,
    }
}

/// A connection's write half, shared by every in-flight request on it.
type SharedWriter = Arc<Mutex<OwnedWriteHalf>>;

/// Unary request/response. Each request is dispatched on its own task so a slow
/// op (a `peek` waiting on the VT actor, a `start` spawning a PTY) can't block
/// the ones behind it; responses carry the request `id` and may interleave.
async fn serve_control(
    mut reader: tokio::net::unix::OwnedReadHalf,
    writer: OwnedWriteHalf,
    manager: Arc<SessionManager>,
    quit: Arc<Notify>,
) -> Result<()> {
    let writer: SharedWriter = Arc::new(Mutex::new(writer));

    while let Some(body) = read_frame(&mut reader).await? {
        let request: Request = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(e) => {
                log::warn!("[daemon] ignoring malformed control request: {e}");
                continue;
            }
        };

        let manager = Arc::clone(&manager);
        let writer = Arc::clone(&writer);
        let quit = Arc::clone(&quit);
        tokio::spawn(async move {
            let id = request.id;
            let quit_requested = matches!(request.op, Op::Quit);
            let result = dispatch(request.op, &manager).await;
            let response = Response { id, result };
            match serde_json::to_vec(&response) {
                Ok(body) => {
                    let mut writer = writer.lock().await;
                    if let Err(e) = write_frame(&mut *writer, &body).await {
                        log::debug!("[daemon] response write failed: {e}");
                    }
                }
                Err(e) => log::warn!("[daemon] could not encode response: {e}"),
            }
            // The response is flushed (write_frame flushes before returning), so
            // the client sees `quit` succeed before the process winds down.
            if quit_requested {
                quit.notify_one();
            }
        });
    }
    Ok(())
}

/// Run `f` on the blocking pool — [`SessionManager`] guards its state with a
/// `std::sync::Mutex`, so it must never be called from an async context.
async fn blocking<T, F>(f: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f).await?
}

/// Wrap a fallible manager call's value as an [`OpResult`].
fn to_result<T: Serialize>(value: Result<T>) -> OpResult {
    match value.and_then(|v| Ok(serde_json::to_value(v)?)) {
        Ok(value) => OpResult::Ok(value),
        Err(e) => OpResult::Err(e.to_string()),
    }
}

/// Execute one control op against the manager.
async fn dispatch(op: Op, manager: &Arc<SessionManager>) -> OpResult {
    let manager = Arc::clone(manager);
    match op {
        Op::Start {
            terminal_id,
            repo_path,
            cwd,
            cols,
            rows,
            shell,
            workspace_id,
        } => {
            // Build the spec exactly like the desktop does, so every front
            // door spawns identical sessions.
            let mut spec = SessionSpec::new(TerminalId::from(terminal_id), repo_path, cwd);
            spec.cols = cols;
            spec.rows = rows;
            spec.shell = shell.map(PathBuf::from);
            spec.workspace_id = workspace_id;
            to_result(blocking(move || manager.start(spec)).await)
        }
        Op::AssignWorkspace {
            terminal_id,
            workspace_id,
        } => {
            let id = TerminalId::from(terminal_id);
            to_result(blocking(move || manager.assign_workspace(&id, workspace_id)).await)
        }
        Op::Write {
            terminal_id,
            data_b64,
        } => {
            let data = match B64.decode(data_b64.as_bytes()) {
                Ok(data) => data,
                Err(e) => return OpResult::Err(format!("invalid base64 payload: {e}")),
            };
            let id = TerminalId::from(terminal_id);
            to_result(blocking(move || manager.write(&id, &data)).await)
        }
        Op::Resize {
            terminal_id,
            cols,
            rows,
        } => {
            let id = TerminalId::from(terminal_id);
            to_result(blocking(move || manager.resize(&id, cols, rows)).await)
        }
        Op::Kill { terminal_id } => {
            let id = TerminalId::from(terminal_id);
            to_result(blocking(move || manager.kill(&id)).await)
        }
        // `list` never fails; only the join can, so lift it into the helper.
        Op::List { repo_path } => {
            to_result(blocking(move || Ok(manager.list(repo_path.as_deref()))).await)
        }
        Op::Replay { terminal_id } => {
            let id = TerminalId::from(terminal_id);
            to_result(
                blocking(move || {
                    let (bytes, cursor, status) = manager.replay(&id)?;
                    Ok(ReplayPayload {
                        data_b64: B64.encode(&bytes),
                        cursor,
                        status: serde_json::to_value(status)?,
                    })
                })
                .await,
            )
        }
        Op::Peek {
            terminal_id,
            scrollback,
        } => {
            let id = TerminalId::from(terminal_id);
            to_result(blocking(move || manager.peek_with(&id, scrollback)).await)
        }
        // Never fails per id — an unknown one is left out of the map, not
        // raised — so only the join can fail; lift it into the helper.
        Op::PeekMany { terminal_ids } => {
            to_result(blocking(move || Ok(manager.peek_many(&terminal_ids))).await)
        }
        Op::Available => OpResult::Ok(serde_json::Value::Bool(true)),
        // Not just the version: this always fingerprints the running binary, so
        // an app built from newer daemon code respawns instead of silently
        // attaching to the old one. The fingerprint is unconditional on purpose
        // — gating it on the build profile would make the debug-built app and
        // the release-built sidecar disagree forever. Served from the identity
        // captured at startup, never recomputed from disk: the file can be
        // rebuilt under a running daemon, and the check exists to catch exactly
        // that. See `STARTUP_IDENTITY` and `build_identity`. The protocol rides
        // along so the app can attach across an identity mismatch when the wire
        // still agrees — sessions surviving an app update. The feature names
        // are the finer-grained form of that: from v3 on a client asks for what
        // it needs by name rather than for a version number, so a daemon that
        // predates the client's newest trick keeps serving everything else.
        Op::Version => to_result(anyhow::Ok(VersionInfo {
            identity: startup_identity().to_owned(),
            protocol: Some(PROTOCOL_VERSION),
            features: features::ALL
                .iter()
                .map(|name| (*name).to_owned())
                .collect(),
        })),
        // `shutdown_all_sessions` kills every session but leaves the daemon
        // serving; `quit` does the same and then lets `serve` return (the
        // caller signals that once this response has been flushed).
        Op::ShutdownAllSessions | Op::Quit => to_result(
            blocking(move || {
                manager.shutdown_all();
                Ok(())
            })
            .await,
        ),
    }
}

// ============================================================
// Stream channel
// ============================================================

/// Subscribe on the blocking pool (the manager takes a `std::sync::Mutex`).
async fn subscribe_blocking(
    manager: &Arc<SessionManager>,
    id: &TerminalId,
) -> Result<Subscription> {
    let manager = Arc::clone(manager);
    let id = id.clone();
    tokio::task::spawn_blocking(move || manager.subscribe(&id)).await?
}

/// The session's current grid, on the blocking pool (same reasoning).
async fn size_blocking(manager: &Arc<SessionManager>, id: &TerminalId) -> Result<(u16, u16)> {
    let manager = Arc::clone(manager);
    let id = id.clone();
    tokio::task::spawn_blocking(move || manager.size(&id)).await?
}

/// Pump one session's live messages to the client until the session exits or the
/// client goes away. Never kills the session.
async fn serve_stream(
    mut reader: tokio::net::unix::OwnedReadHalf,
    mut writer: OwnedWriteHalf,
    manager: Arc<SessionManager>,
    id: TerminalId,
) -> Result<()> {
    let subscription = match subscribe_blocking(&manager, &id).await {
        Ok(subscription) => subscription,
        Err(e) => {
            // Tell the client the terminal is unknown, then close.
            let frame = StreamFrame::Error {
                message: e.to_string(),
            };
            write_frame(&mut writer, &frame.encode()).await?;
            return Ok(());
        }
    };

    let mut rx = subscription.rx;

    // Open with the PTY's current grid. A client seeding its render from a
    // stale session listing — or reconnecting after missing a resize — has no
    // other way to learn the real size, since an unchanged resize is a no-op
    // and nothing else on this stream carries geometry.
    if let Ok((cols, rows)) = size_blocking(&manager, &id).await {
        write_frame(&mut writer, &StreamFrame::Resized { cols, rows }.encode()).await?;
    }

    // A stream connection carries no client→daemon traffic; reading it exists
    // only to notice a disconnect promptly and drop the subscription.
    let mut discard = [0u8; 64];

    loop {
        let message = tokio::select! {
            message = rx.recv() => message,
            read = reader.read(&mut discard) => match read {
                Ok(0) | Err(_) => return Ok(()), // client detached
                Ok(_) => continue,               // unexpected input; ignore
            },
        };

        let frame = match message {
            Some(TerminalMessage::Output { data, seq }) => {
                // The hot path — one frame per PTY chunk. Encode the length
                // prefix and body into a single buffer and write it once; see
                // `encode_output_framed`.
                let framed = encode_output_framed(seq, &data)?;
                if writer.write_all(&framed).await.is_err() || writer.flush().await.is_err() {
                    return Ok(()); // client went away
                }
                continue;
            }
            Some(TerminalMessage::Status(status)) => {
                StreamFrame::Status(serde_json::to_value(status)?)
            }
            Some(TerminalMessage::Resized { cols, rows }) => StreamFrame::Resized { cols, rows },
            Some(TerminalMessage::Exit(exit_code)) => {
                write_frame(&mut writer, &StreamFrame::Exit { exit_code }.encode()).await?;
                return Ok(());
            }
            None => {
                // The channel closed while the session may still be alive: this
                // consumer fell behind and was dropped. Re-subscribe and carry
                // on, discarding the fresh replay (the client already has the
                // earlier bytes) — but re-announce the grid, since a Resized
                // may have been among the frames the lag cost.
                match subscribe_blocking(&manager, &id).await {
                    Ok(subscription) => {
                        rx = subscription.rx;
                        if let Ok((cols, rows)) = size_blocking(&manager, &id).await {
                            let frame = StreamFrame::Resized { cols, rows };
                            if write_frame(&mut writer, &frame.encode()).await.is_err() {
                                return Ok(()); // client went away
                            }
                        }
                        continue;
                    }
                    Err(_) => return Ok(()), // session is gone for good
                }
            }
        };

        if write_frame(&mut writer, &frame.encode()).await.is_err() {
            return Ok(()); // client went away
        }
    }
}

// ============================================================
// Events channel
// ============================================================

/// Pump every session's lifecycle to one client until it goes away.
///
/// Deliberately unlike [`serve_stream`] in two ways. It opens with nothing —
/// the client's own [`Op::List`], taken after this connection exists, is the
/// baseline the events apply to, and sending a snapshot here would only race
/// that one. And falling behind is not fatal: the client is told
/// ([`Event::Lagged`]) and keeps receiving, because the fix is a fresh `list`,
/// not a reconnect.
async fn serve_events(
    mut reader: tokio::net::unix::OwnedReadHalf,
    mut writer: OwnedWriteHalf,
    manager: Arc<SessionManager>,
) -> Result<()> {
    let mut rx = manager.subscribe_events().rx;

    // As on a stream connection, reading exists only to notice a disconnect
    // promptly — the client never sends anything here.
    let mut discard = [0u8; 64];

    loop {
        let received = tokio::select! {
            received = rx.recv() => received,
            read = reader.read(&mut discard) => match read {
                Ok(0) | Err(_) => return Ok(()), // client detached
                Ok(_) => continue,               // unexpected input; ignore
            },
        };

        let event = match received {
            // An event that will not serialize (nothing in these payloads can,
            // but the encoder is allowed to say so) costs that one event, not
            // the connection — dropping the channel would cost the client every
            // session's live status over one unencodable field.
            Ok(event) => match wire_event(event) {
                Ok(event) => event,
                Err(e) => {
                    log::warn!("[daemon] dropping an unencodable event: {e}");
                    continue;
                }
            },
            // One `lagged` per episode: the receiver is repositioned by the
            // error itself, so the next overflow is the next report.
            Err(tokio::sync::broadcast::error::RecvError::Lagged(dropped)) => {
                log::debug!("[daemon] events subscriber lagged, dropped {dropped}");
                Event::Lagged
            }
            // The manager is gone, so there is nothing left to report.
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
        };

        if write_frame(&mut writer, &event.encode()).await.is_err() {
            return Ok(()); // client went away
        }
    }
}

/// Map a manager event onto its wire form, serializing the terminal-typed
/// payloads the protocol module deliberately does not know about.
fn wire_event(event: SessionEvent) -> Result<Event> {
    Ok(match event {
        SessionEvent::Started(summary) => Event::Started {
            session: serde_json::to_value(*summary)?,
        },
        SessionEvent::Status(status) => Event::Status {
            status: serde_json::to_value(status)?,
        },
        SessionEvent::Resized { id, cols, rows } => Event::Resized {
            terminal_id: id.0,
            cols,
            rows,
        },
        SessionEvent::WorkspaceAssigned { id, workspace_id } => Event::WorkspaceAssigned {
            terminal_id: id.0,
            workspace_id,
        },
        SessionEvent::Exited { id, exit_code } => Event::Exited {
            terminal_id: id.0,
            exit_code,
        },
        SessionEvent::Removed { id } => Event::Removed { terminal_id: id.0 },
    })
}

#[cfg(all(test, feature = "daemon-client"))]
mod tests {
    use super::*;
    use crate::daemon::test_support::{start_op, Harness, TIMEOUT};
    use crate::daemon::DaemonClient;
    use serde_json::Value;
    use std::time::Duration;

    #[tokio::test]
    async fn socket_is_created_with_owner_only_permissions() {
        let harness = Harness::start().await;
        let mode = std::fs::metadata(&harness.socket)
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(
            mode & 0o777,
            0o600,
            "socket must not be group/world readable"
        );
        // The pid file lands beside the socket and names this process.
        let pid = std::fs::read_to_string(pid_path(&harness.socket)).unwrap();
        assert_eq!(pid, std::process::id().to_string());
    }

    #[tokio::test]
    async fn second_daemon_refuses_a_live_socket() {
        let harness = Harness::start().await;
        let err = serve(harness.socket.clone()).await.unwrap_err();
        assert!(
            err.to_string().contains("already listening"),
            "unexpected error: {err}"
        );
    }

    /// The identity a *shipped* daemon reports must equal the one the app
    /// computes for that same binary — even though the two are built with
    /// different profiles (in dev the app is a debug build while the sidecar
    /// daemon is built `--release`). Anything profile-dependent in
    /// `build_identity` makes them disagree forever, so the app respawns the
    /// daemon on every launch and no session ever survives.
    ///
    /// This test is debug-built and talks to the release binary on purpose.
    /// It needs the sidecar to exist and to match this tree's version, and
    /// building it is a `--release` compile nobody wants on every
    /// `scripts/test`, so by default a missing *or* stale sidecar skips. Set
    /// [`REQUIRE_SIDECAR`] (CI, the release pipeline) to turn either skip into
    /// a failure — otherwise the invariant most likely to break silently would
    /// be guarded by a test that silently never runs.
    #[tokio::test]
    async fn a_release_built_daemon_reports_the_identity_we_expect() {
        let required = std::env::var_os(REQUIRE_SIDECAR).is_some();
        let Some(binary) = release_sidecar_path() else {
            assert!(
                !required,
                "{REQUIRE_SIDECAR} is set but no release sidecar has been built — \
                 run scripts/build-daemon-sidecar first"
            );
            eprintln!(
                "skipping: no release sidecar built (set {REQUIRE_SIDECAR} to make this a failure)"
            );
            return;
        };

        let dir = tempfile::TempDir::new().unwrap();
        let socket = dir.path().join("daemon.sock");
        let mut child = tokio::process::Command::new(&binary)
            .env("REVIEW_HOME", dir.path())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawning the release daemon");

        let deadline = tokio::time::Instant::now() + TIMEOUT;
        while !socket.exists() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let client = DaemonClient::connect(&socket).await.unwrap();
        let reported = client.version().await.unwrap();
        let _ = child.kill().await;

        // A sidecar built before the protocol was versioned reports a bare
        // string (no protocol). Same reasoning as the version skip below: the
        // artifact is stale, not the identity buggy.
        if reported.protocol.is_none() && !required {
            eprintln!(
                "skipping: sidecar predates protocol versioning — rebuild it with \
                 scripts/build-daemon-sidecar (set {REQUIRE_SIDECAR} to make this a failure)"
            );
            return;
        }

        // A sidecar built from a different version cannot answer the question
        // this test asks. It compares two *profiles* of one version; against an
        // older binary a mismatch is guaranteed and means only "the tree moved
        // since this sidecar was built". Failing there reports a build-identity
        // bug for what is really a stale artifact, so it skips instead — the
        // same reasoning as the missing-sidecar skip above. The release
        // pipeline sets REQUIRE_SIDECAR immediately after building the sidecar
        // from the bumped version, so there a version mismatch is real.
        let version = env!("CARGO_PKG_VERSION");
        let reported_version = reported.identity.split('+').next().unwrap_or_default();
        if reported_version != version && !required {
            eprintln!(
                "skipping: sidecar reports version {reported_version}, tree is {version} \
                 — rebuild it with scripts/build-daemon-sidecar \
                 (set {REQUIRE_SIDECAR} to make this a failure)"
            );
            return;
        }

        assert_eq!(
            reported.identity,
            crate::daemon::build_identity(version, &binary),
            "release daemon and debug caller disagree on the build identity"
        );
        assert_eq!(reported.protocol, Some(PROTOCOL_VERSION));
    }

    /// Set this to require the release sidecar rather than skipping without it.
    const REQUIRE_SIDECAR: &str = "REVIEW_REQUIRE_SIDECAR_TESTS";

    /// The sidecar artifact, if it has been built for this host.
    fn release_sidecar_path() -> Option<PathBuf> {
        let triple = std::env::var("TAURI_TARGET_TRIPLE").ok().or_else(|| {
            let arch = if cfg!(target_arch = "aarch64") {
                "aarch64"
            } else {
                "x86_64"
            };
            cfg!(target_os = "macos").then(|| format!("{arch}-apple-darwin"))
        })?;
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()?
            .join("desktop/tauri/binaries")
            .join(format!("review-daemon-{triple}"));
        path.is_file().then_some(path)
    }

    #[tokio::test]
    async fn version_and_available_answer_without_sessions() {
        let harness = Harness::start().await;
        let client = harness.client().await;

        // The identity is the version plus a binary fingerprint (see
        // `build_identity`), so the version is a prefix, not the whole string.
        let version = client.version().await.unwrap();
        assert!(version.identity.starts_with(env!("CARGO_PKG_VERSION")));
        assert_eq!(version.protocol, Some(PROTOCOL_VERSION));
        assert_eq!(
            client.request(Op::Available).await.unwrap(),
            Value::Bool(true)
        );
        assert_eq!(
            client
                .request(Op::List { repo_path: None })
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn start_stream_replay_peek_list_kill_round_trip() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        let repo = tempfile::TempDir::new().unwrap();
        let other_repo = tempfile::TempDir::new().unwrap();
        let id = "daemon-rt-1";

        let summary = client.request(start_op(id, repo.path())).await.unwrap();
        assert_eq!(summary["id"], id);
        assert_eq!(summary["cols"], 80);

        // Subscribe before writing so no output is missed.
        let mut stream = client.open_stream(id).await.unwrap();

        client
            .request(Op::Write {
                terminal_id: id.to_owned(),
                data_b64: B64.encode(b"echo daemon-ok\n"),
            })
            .await
            .unwrap();

        // The live stream carries the echoed marker as raw bytes.
        let mut seen: Vec<u8> = Vec::new();
        let mut last_seq = 0;
        let saw_marker = tokio::time::timeout(TIMEOUT, async {
            while let Some(frame) = stream.recv().await {
                if let StreamFrame::Output { seq, data } = frame {
                    seen.extend_from_slice(&data);
                    last_seq = seq;
                    if String::from_utf8_lossy(&seen).contains("daemon-ok") {
                        return true;
                    }
                }
            }
            false
        })
        .await
        .unwrap_or(false);
        assert!(saw_marker, "stream never delivered the echoed marker");
        assert!(last_seq > 0, "output frames must carry a scrollback cursor");

        // Replay returns the same bytes as scrollback, plus a cursor and status.
        let replay = client
            .request(Op::Replay {
                terminal_id: id.to_owned(),
            })
            .await
            .unwrap();
        let scrollback = B64.decode(replay["dataB64"].as_str().unwrap()).unwrap();
        assert!(String::from_utf8_lossy(&scrollback).contains("daemon-ok"));
        assert_eq!(
            replay["cursor"].as_u64().unwrap() as usize,
            scrollback.len()
        );
        assert_eq!(replay["status"]["id"], id);

        // Peek renders the screen through the VT actor, which trails the PTY.
        let peeked = poll_until(TIMEOUT, || async {
            let text = client.peek_with(id, 0).await.ok()?;
            text.contains("daemon-ok").then_some(())
        })
        .await;
        assert!(peeked, "peek never reflected the echoed marker");

        // List sees it under its own repo, and only there.
        let all = client.request(Op::List { repo_path: None }).await.unwrap();
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["id"], id);
        let elsewhere = client
            .request(Op::List {
                repo_path: Some(other_repo.path().to_string_lossy().into_owned()),
            })
            .await
            .unwrap();
        assert!(elsewhere.as_array().unwrap().is_empty());

        // Kill tears the session down: the stream gets an Exit frame and later
        // ops on the id fail.
        client
            .request(Op::Kill {
                terminal_id: id.to_owned(),
            })
            .await
            .unwrap();

        let saw_exit = tokio::time::timeout(TIMEOUT, async {
            while let Some(frame) = stream.recv().await {
                if matches!(frame, StreamFrame::Exit { .. }) {
                    return true;
                }
            }
            false
        })
        .await
        .unwrap_or(false);
        assert!(saw_exit, "kill did not deliver an Exit frame");

        assert!(client.peek_with(id, 0).await.is_err());
        assert!(client
            .request(Op::List { repo_path: None })
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    /// Every stream opens by announcing the PTY's current grid, so a client
    /// attaching (or reconnecting) with a stale idea of the size learns the
    /// truth without anyone having to resize.
    #[tokio::test]
    async fn a_new_stream_opens_with_the_current_grid() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        let repo = tempfile::TempDir::new().unwrap();
        let id = "grid-announce";

        client.request(start_op(id, repo.path())).await.unwrap();
        client
            .request(Op::Resize {
                terminal_id: id.to_owned(),
                cols: 101,
                rows: 31,
            })
            .await
            .unwrap();

        let mut stream = client.open_stream(id).await.unwrap();
        let first = tokio::time::timeout(TIMEOUT, stream.recv())
            .await
            .unwrap()
            .expect("the stream should open with a frame");
        assert_eq!(
            first,
            StreamFrame::Resized {
                cols: 101,
                rows: 31
            },
            "the opening frame must announce the current grid"
        );

        client
            .request(Op::Kill {
                terminal_id: id.to_owned(),
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn stream_to_unknown_terminal_yields_an_error_frame() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        let mut stream = client.open_stream("nope").await.unwrap();

        let frame = tokio::time::timeout(TIMEOUT, stream.recv())
            .await
            .unwrap()
            .expect("expected an error frame");
        match frame {
            StreamFrame::Error { message } => assert!(message.contains("nope"), "{message}"),
            other => panic!("expected an error frame, got {other:?}"),
        }
        // And the daemon closes the connection right after.
        assert!(tokio::time::timeout(TIMEOUT, stream.recv())
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn shutdown_all_sessions_empties_but_keeps_serving() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        let repo = tempfile::TempDir::new().unwrap();

        client
            .request(start_op("keep-serving-1", repo.path()))
            .await
            .unwrap();
        client
            .request(start_op("keep-serving-2", repo.path()))
            .await
            .unwrap();
        assert_eq!(
            client
                .request(Op::List { repo_path: None })
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );

        client.request(Op::ShutdownAllSessions).await.unwrap();

        // Sessions are gone, the daemon is not.
        assert!(client
            .request(Op::List { repo_path: None })
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
        // The identity is the version plus a binary fingerprint (see
        // `build_identity`), so the version is a prefix, not the whole string.
        assert!(client
            .version()
            .await
            .unwrap()
            .identity
            .starts_with(env!("CARGO_PKG_VERSION")));
    }

    /// The whole point of the daemon: a session belongs to the daemon, not to
    /// whoever is attached. Dropping every client connection (the app quitting,
    /// or crashing) must leave the shell running, and a fresh client (the app
    /// reopening) must find it, replay its scrollback, and keep typing at it.
    #[tokio::test]
    async fn sessions_outlive_the_client_that_started_them() {
        let harness = Harness::start().await;
        let repo = tempfile::TempDir::new().unwrap();
        let id = "daemon-survives-1";

        // First "app run": start a session and leave a marker in its scrollback.
        {
            let client = harness.client().await;
            client.request(start_op(id, repo.path())).await.unwrap();
            let mut stream = client.open_stream(id).await.unwrap();
            client.write(id, b"echo before-quit\n").await.unwrap();
            let mut seen: Vec<u8> = Vec::new();
            let saw = tokio::time::timeout(TIMEOUT, async {
                while let Some(frame) = stream.recv().await {
                    if let StreamFrame::Output { data, .. } = frame {
                        seen.extend_from_slice(&data);
                        if String::from_utf8_lossy(&seen).contains("before-quit") {
                            return true;
                        }
                    }
                }
                false
            })
            .await
            .unwrap_or(false);
            assert!(saw, "first client never saw its own output");
            // Both connections drop here — the app has quit.
        }

        // Second "app run": a brand-new client attaches to the same daemon.
        let client = harness.client().await;

        let all = client.request(Op::List { repo_path: None }).await.unwrap();
        assert_eq!(
            all.as_array().unwrap().len(),
            1,
            "session did not survive the client disconnecting"
        );
        assert_eq!(all[0]["id"], id);

        // Scrollback from before the "quit" is still there to repaint the pane.
        let replay = client
            .request(Op::Replay {
                terminal_id: id.to_owned(),
            })
            .await
            .unwrap();
        let scrollback = B64.decode(replay["dataB64"].as_str().unwrap()).unwrap();
        assert!(
            String::from_utf8_lossy(&scrollback).contains("before-quit"),
            "scrollback lost across reattach"
        );

        // And the shell is still live: a fresh stream sees new output.
        let mut stream = client.open_stream(id).await.unwrap();
        client.write(id, b"echo after-reattach\n").await.unwrap();
        let mut seen: Vec<u8> = Vec::new();
        let saw = tokio::time::timeout(TIMEOUT, async {
            while let Some(frame) = stream.recv().await {
                if let StreamFrame::Output { data, .. } = frame {
                    seen.extend_from_slice(&data);
                    if String::from_utf8_lossy(&seen).contains("after-reattach") {
                        return true;
                    }
                }
            }
            false
        })
        .await
        .unwrap_or(false);
        assert!(saw, "reattached session is no longer interactive");
    }

    #[tokio::test]
    async fn quit_answers_then_stops_the_daemon() {
        let mut harness = Harness::start().await;
        let client = harness.client().await;
        let repo = tempfile::TempDir::new().unwrap();
        client
            .request(start_op("quit-1", repo.path()))
            .await
            .unwrap();

        // The response arrives before the process winds down.
        client.request(Op::Quit).await.unwrap();

        // `serve` returns, and cleans the socket and pid file up behind it.
        let served = tokio::time::timeout(TIMEOUT, &mut harness.task).await;
        assert!(served.is_ok(), "serve() did not return after quit");
        assert!(!harness.socket.exists(), "socket file was left behind");
        assert!(
            !pid_path(&harness.socket).exists(),
            "pid file was left behind"
        );
    }

    /// Collect events until `found` matches one, or [`TIMEOUT`] elapses.
    /// Returns everything seen, so a test can assert on the sequence.
    async fn events_until(
        handle: &mut crate::daemon::EventsHandle,
        found: impl Fn(&Event) -> bool,
    ) -> Vec<Event> {
        let mut seen = Vec::new();
        let _ = tokio::time::timeout(TIMEOUT, async {
            while let Some(event) = handle.recv().await {
                let done = found(&event);
                seen.push(event);
                if done {
                    return;
                }
            }
        })
        .await;
        seen
    }

    fn is_removed(event: &Event, wanted: &str) -> bool {
        matches!(event, Event::Removed { terminal_id } if terminal_id == wanted)
    }

    /// The whole point of the channel: one connection, and every session's
    /// life shows up on it — including sessions this client never started.
    #[tokio::test]
    async fn the_events_channel_narrates_every_session() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        let repo = tempfile::TempDir::new().unwrap();
        let id = "events-rt";

        // Subscribe first: the invariant is about a `list` taken *after* this.
        let mut events = client.open_events().await.unwrap();
        assert!(client
            .request(Op::List { repo_path: None })
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());

        client.request(start_op(id, repo.path())).await.unwrap();
        let seen = events_until(&mut events, |e| matches!(e, Event::Started { .. })).await;
        match seen.last() {
            // The payload is the same `TerminalSummary` `list` returns, so a
            // client can put it straight into its list without a round trip.
            Some(Event::Started { session }) => {
                assert_eq!(session["id"], id);
                assert_eq!(session["cols"], 80);
            }
            other => panic!("no started event: {other:?}"),
        }

        client
            .request(Op::Resize {
                terminal_id: id.to_owned(),
                cols: 101,
                rows: 31,
            })
            .await
            .unwrap();
        let seen = events_until(&mut events, |e| matches!(e, Event::Resized { .. })).await;
        assert!(
            seen.contains(&Event::Resized {
                terminal_id: id.to_owned(),
                cols: 101,
                rows: 31,
            }),
            "resize never reached the events channel: {seen:?}"
        );

        client
            .assign_workspace(id, Some("0a1b2c3d".to_owned()))
            .await
            .unwrap();
        let seen = events_until(&mut events, |e| {
            matches!(e, Event::WorkspaceAssigned { .. })
        })
        .await;
        assert!(
            seen.contains(&Event::WorkspaceAssigned {
                terminal_id: id.to_owned(),
                workspace_id: Some("0a1b2c3d".to_owned()),
            }),
            "reassignment never reached the events channel: {seen:?}"
        );

        // A status transition carries the same object the per-session stream
        // does, so one drain can feed every phase dot.
        client.write(id, b"sleep 5\n").await.unwrap();
        let seen = events_until(
            &mut events,
            |e| matches!(e, Event::Status { status } if status["runningCommand"] == "sleep"),
        )
        .await;
        assert!(
            seen.iter().any(
                |e| matches!(e, Event::Status { status } if status["runningCommand"] == "sleep")
            ),
            "no status transition on the events channel: {seen:?}"
        );

        // Killing says both things, in order — and `list` agrees.
        client
            .request(Op::Kill {
                terminal_id: id.to_owned(),
            })
            .await
            .unwrap();
        let seen = events_until(&mut events, |e| is_removed(e, id)).await;
        let exited = seen
            .iter()
            .position(|e| matches!(e, Event::Exited { terminal_id, .. } if terminal_id == id));
        let removed = seen.iter().position(|e| is_removed(e, id));
        assert!(exited.is_some(), "no exited event: {seen:?}");
        assert!(removed.is_some(), "no removed event: {seen:?}");
        assert!(exited < removed, "removed must follow exited: {seen:?}");
        assert!(client
            .request(Op::List { repo_path: None })
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    /// A subscriber that stops reading must be told it lost events and then
    /// keep being served — the fix for a lag is a fresh `list`, not a
    /// reconnect, and dropping the connection would cost the client every
    /// session's live status until it noticed.
    #[tokio::test]
    async fn a_lagging_subscriber_is_told_and_keeps_serving() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        let repo = tempfile::TempDir::new().unwrap();

        let id = "lag-source";
        client.request(start_op(id, repo.path())).await.unwrap();
        let mut events = client.open_events().await.unwrap();

        // Overflow every cushion between the bus and this client — which never
        // reads a frame until the loop is done — using the cheapest event
        // there is: reassignment touches no PTY and is announced
        // unconditionally. The count has to clear the daemon's bus, the
        // socket's own buffers, and this handle's queue, so it is deliberately
        // far more than the sum of the two we know.
        let overflow = 20 * crate::terminal::EVENT_CHANNEL_CAPACITY;
        for chunk in (0..overflow).collect::<Vec<_>>().chunks(500) {
            let sending = chunk
                .iter()
                .map(|n| client.assign_workspace(id, Some(format!("w{n}"))));
            for result in futures::future::join_all(sending).await {
                result.unwrap();
            }
        }

        let seen = events_until(&mut events, |e| matches!(e, Event::Lagged)).await;
        assert!(
            seen.contains(&Event::Lagged),
            "a subscriber that fell behind was never told: {} events seen",
            seen.len()
        );

        // Still connected, and still narrating: a session started after the
        // lag arrives like any other.
        client
            .request(start_op("after-the-lag", repo.path()))
            .await
            .unwrap();
        let seen = events_until(
            &mut events,
            |e| matches!(e, Event::Started { session } if session["id"] == "after-the-lag"),
        )
        .await;
        assert!(
            seen.iter().any(
                |e| matches!(e, Event::Started { session } if session["id"] == "after-the-lag")
            ),
            "the connection stopped serving after a lag"
        );

        client.request(Op::ShutdownAllSessions).await.unwrap();
    }

    /// `peek` reaches past the visible screen only when asked, and `peek_many`
    /// answers for a set of sessions in one round trip.
    #[tokio::test]
    async fn peek_takes_a_scrollback_depth_and_a_batch_of_ids() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        let repo = tempfile::TempDir::new().unwrap();
        let id = "peek-history";

        client.request(start_op(id, repo.path())).await.unwrap();
        // 24 rows of grid; scroll a marker well off the top of it.
        client
            .write(id, b"echo scrolled-marker; for i in 1 2 3 4 5 6 7 8 9 0; do echo pad$i; echo pad$i; echo pad$i; done\n")
            .await
            .unwrap();

        // The marker leaves the visible screen…
        let gone = poll_until(TIMEOUT, || async {
            let screen = client.peek_with(id, 0).await.ok()?;
            (!screen.contains("scrolled-marker") && screen.contains("pad0")).then_some(())
        })
        .await;
        assert!(gone, "the marker never scrolled off the visible screen");

        // …but history brings it back, and asking for everything is enough.
        let full = client.peek_with(id, u32::MAX).await.unwrap();
        assert!(
            full.contains("scrolled-marker"),
            "history did not reach the scrolled-off marker: {full:?}"
        );
        assert!(
            full.lines().count() > client.peek_with(id, 0).await.unwrap().lines().count(),
            "history rendered no more than the viewport"
        );

        // A batch answers for what exists and omits what does not.
        let screens = client
            .peek_many(&[id.to_owned(), "nobody".to_owned()])
            .await
            .unwrap();
        assert!(screens.contains_key(id), "batch missed a live session");
        assert!(
            !screens.contains_key("nobody"),
            "an unknown id must be omitted, not raised: {screens:?}"
        );

        client
            .request(Op::Kill {
                terminal_id: id.to_owned(),
            })
            .await
            .unwrap();
    }

    /// Poll `f` until it yields `Some`, or `timeout` elapses.
    async fn poll_until<F, Fut>(timeout: Duration, mut f: F) -> bool
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Option<()>>,
    {
        tokio::time::timeout(timeout, async {
            loop {
                if f().await.is_some() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .is_ok()
    }
}
