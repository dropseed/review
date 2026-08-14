//! The client half of the daemon protocol.
//!
//! [`DaemonClient`] owns one **control** connection and multiplexes any number
//! of concurrent requests over it by `id`, so it can be held in shared state
//! (`&self`, cheap to clone) and called from many Tauri commands at once.
//! Streams are separate connections opened per session via
//! [`DaemonClient::open_stream`].
//!
//! This module never touches `crate::terminal`: control payloads come back as
//! `serde_json::Value` for the caller to deserialize into whatever it already
//! has (`TerminalSummary`, `SessionStatus`, …). That keeps the `daemon-client`
//! feature free of `portable-pty` and friends.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use serde_json::Value;
use tokio::net::unix::OwnedWriteHalf;
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot};

use super::codec::{read_frame, write_frame};
use super::protocol::{Hello, Op, OpResult, Request, Response, StreamFrame, B64};

/// Buffered [`StreamFrame`]s per open stream before the reader task blocks.
/// Matches the daemon-side subscriber bound, so back-pressure surfaces there
/// (where re-subscribe recovery lives) rather than here.
const STREAM_CHANNEL_CAPACITY: usize = 1024;

/// Requests awaiting a response, keyed by request id.
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<OpResult>>>>;

/// The fields of a `TerminalSummary` this module's workspace helpers use.
/// Deserializing the subset keeps the client free of `crate::terminal`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribution {
    id: String,
    workspace_id: Option<String>,
    title: Option<String>,
}

/// What the daemon knows about the queue's workspaces, in one answer.
///
/// The two halves are asked for together because they are read together: a
/// liveness read decides what to reap *and* what to call a workspace that has
/// nothing else to be named after (see `crate::work::Workspace::display_title`).
/// Splitting them would cost a second `Op::List` per read for the same data.
#[derive(Debug, Clone, Default)]
pub struct LiveWorkspaces {
    /// Every workspace with at least one live session.
    pub ids: HashSet<String>,
    /// Workspace id → the title of its first titled live session.
    pub titles: HashMap<String, String>,
}

/// A connected control channel to the terminal daemon.
#[derive(Clone, Debug)]
pub struct DaemonClient {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    /// The socket this client connected on; per-session stream connections
    /// ([`DaemonClient::open_stream`]) dial it again, so holding a client is
    /// enough to use the daemon — no caller carries the path separately.
    socket: PathBuf,
    /// Serializes frame writes; requests are otherwise fully concurrent.
    writer: tokio::sync::Mutex<OwnedWriteHalf>,
    next_id: AtomicU64,
    pending: Pending,
    reader: tokio::task::JoinHandle<()>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

impl DaemonClient {
    /// Open the control connection to the daemon listening on `socket`.
    pub async fn connect(socket: &Path) -> Result<Self> {
        let stream = UnixStream::connect(socket)
            .await
            .with_context(|| format!("connecting to daemon at {}", socket.display()))?;
        let (mut read_half, mut write_half) = stream.into_split();

        let hello = serde_json::to_vec(&Hello::Control)?;
        write_frame(&mut write_half, &hello).await?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let reader = tokio::spawn({
            let pending = Arc::clone(&pending);
            async move {
                // Route each response to the request waiting on its id.
                while let Ok(Some(body)) = read_frame(&mut read_half).await {
                    match serde_json::from_slice::<Response>(&body) {
                        Ok(response) => {
                            let waiting = pending
                                .lock()
                                .expect("pending poisoned")
                                .remove(&response.id);
                            if let Some(tx) = waiting {
                                let _ = tx.send(response.result);
                            }
                        }
                        Err(e) => log::warn!("[daemon client] malformed response: {e}"),
                    }
                }
                // The connection ended: drop every waiter so in-flight requests
                // fail fast instead of hanging forever.
                pending.lock().expect("pending poisoned").clear();
            }
        });

        Ok(Self {
            inner: Arc::new(Inner {
                socket: socket.to_path_buf(),
                writer: tokio::sync::Mutex::new(write_half),
                next_id: AtomicU64::new(1),
                pending,
                reader,
            }),
        })
    }

    /// Run one op and return its Ok payload, mapping a daemon-side failure to an
    /// `Err`. Safe to call concurrently from any number of tasks.
    pub async fn request(&self, op: Op) -> Result<Value> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let body = serde_json::to_vec(&Request { id, op })?;

        let (tx, rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .expect("pending poisoned")
            .insert(id, tx);

        let write = {
            let mut writer = self.inner.writer.lock().await;
            write_frame(&mut *writer, &body).await
        };
        if let Err(e) = write {
            self.inner
                .pending
                .lock()
                .expect("pending poisoned")
                .remove(&id);
            return Err(e).context("sending request to daemon");
        }

        match rx.await {
            Ok(OpResult::Ok(value)) => Ok(value),
            Ok(OpResult::Err(message)) => Err(anyhow!(message)),
            Err(_) => Err(anyhow!("daemon connection closed before responding")),
        }
    }

    /// Run one op and decode its Ok payload into `T` — the typed counterpart
    /// of [`DaemonClient::request`] for callers that know the payload shape
    /// (`TerminalSummary`, `SessionStatus`, …). Generic on purpose: this
    /// module still never references `crate::terminal`.
    pub async fn request_as<T: serde::de::DeserializeOwned>(&self, op: Op) -> Result<T> {
        let value = self.request(op).await?;
        serde_json::from_value(value).context("unexpected daemon response")
    }

    /// Write bytes to a session's stdin, handling the wire's base64 encoding
    /// (the control channel is JSON; PTY input is arbitrary bytes).
    pub async fn write(&self, terminal_id: &str, data: &[u8]) -> Result<()> {
        self.request(Op::Write {
            terminal_id: terminal_id.to_owned(),
            data_b64: B64.encode(data),
        })
        .await
        .map(|_| ())
    }

    /// What the daemon can say about the queue's workspaces right now.
    ///
    /// The liveness half of [`crate::work::cleanup`]: the queue is this
    /// process's to read, but "is anything running in it?" is only the daemon's
    /// to answer, and a caller that cannot reach the daemon must not guess.
    pub async fn live_workspaces(&self) -> Result<LiveWorkspaces> {
        let mut live = LiveWorkspaces::default();
        for session in self.attributions().await? {
            let Some(workspace_id) = session.workspace_id else {
                continue;
            };
            if let Some(title) = session.title.filter(|title| !title.trim().is_empty()) {
                // First titled session wins: sessions come back in start order,
                // so a workspace is named after the thing that opened it rather
                // than after whatever was started in it last.
                live.titles.entry(workspace_id.clone()).or_insert(title);
            }
            live.ids.insert(workspace_id);
        }
        Ok(live)
    }

    /// Move every session attributed to one of `from` onto `to`, returning how
    /// many moved.
    ///
    /// Attribution is the daemon's state, not the queue's, so moving a whole
    /// workspace's sessions is a daemon round trip. Nothing happens for an empty
    /// `from`, so the `Op::List` this needs is only ever paid when there is
    /// something to move.
    pub async fn reassign_sessions(&self, from: &[String], to: &str) -> Result<usize> {
        if from.is_empty() {
            return Ok(0);
        }
        // The assignments are independent of each other, so they go out
        // together rather than one round trip after another — moving a
        // workspace with several shells in it is one wait, not n.
        let moving = self
            .attributions()
            .await?
            .into_iter()
            .filter(|session| {
                session
                    .workspace_id
                    .as_ref()
                    .is_some_and(|id| from.contains(id))
            })
            .map(|session| {
                self.request(Op::AssignWorkspace {
                    terminal_id: session.id,
                    workspace_id: Some(to.to_owned()),
                })
            })
            .collect::<Vec<_>>();

        let moved = moving.len();
        for result in futures::future::join_all(moving).await {
            result?;
        }
        Ok(moved)
    }

    /// Every session as `(id, workspace)`. Decoded into a local shape rather
    /// than `TerminalSummary` to keep this module free of `crate::terminal`.
    pub async fn attributions(&self) -> Result<Vec<Attribution>> {
        self.request_as(Op::List { repo_path: None }).await
    }

    /// The daemon's crate version — the desktop compares it against its own and
    /// respawns the daemon on a mismatch.
    pub async fn version(&self) -> Result<String> {
        let value = self.request(Op::Version).await?;
        value
            .as_str()
            .map(ToOwned::to_owned)
            .ok_or_else(|| anyhow!("daemon returned a non-string version: {value}"))
    }

    /// Open a second connection carrying one session's live output.
    ///
    /// The returned handle is a dumb pump: loop on [`StreamHandle::recv`] until
    /// it yields `None`. Dropping it closes the connection, which drops the
    /// daemon-side subscription — it never kills the session.
    pub async fn open_stream(&self, terminal_id: &str) -> Result<StreamHandle> {
        let socket = &self.inner.socket;
        let stream = UnixStream::connect(socket)
            .await
            .with_context(|| format!("connecting to daemon at {}", socket.display()))?;
        let (mut read_half, mut write_half) = stream.into_split();

        let hello = serde_json::to_vec(&Hello::Stream {
            terminal_id: terminal_id.to_owned(),
        })?;
        write_frame(&mut write_half, &hello).await?;

        let (tx, frames) = mpsc::channel(STREAM_CHANNEL_CAPACITY);
        let task = tokio::spawn(async move {
            // Hold the write half open for the connection's lifetime; the daemon
            // watches it for EOF to notice a detached client.
            let _write_half = write_half;
            while let Ok(Some(body)) = read_frame(&mut read_half).await {
                match StreamFrame::decode(&body) {
                    Ok(frame) => {
                        if tx.send(frame).await.is_err() {
                            return; // consumer went away
                        }
                    }
                    Err(e) => {
                        log::warn!("[daemon client] malformed stream frame: {e}");
                        return;
                    }
                }
            }
        });

        Ok(StreamHandle { frames, task })
    }
}

/// A live stream of one session's [`StreamFrame`]s.
#[derive(Debug)]
pub struct StreamHandle {
    frames: mpsc::Receiver<StreamFrame>,
    task: tokio::task::JoinHandle<()>,
}

impl StreamHandle {
    /// The next frame, or `None` once the daemon closed the stream (after an
    /// [`StreamFrame::Exit`] or [`StreamFrame::Error`]) or the connection died.
    pub async fn recv(&mut self) -> Option<StreamFrame> {
        self.frames.recv().await
    }
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        // Abort the reader so the socket closes now rather than whenever the
        // next frame happens to arrive.
        self.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn connect_to_a_missing_socket_errors() {
        let dir = tempfile::TempDir::new().unwrap();
        let err = DaemonClient::connect(&dir.path().join("absent.sock"))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("connecting to daemon"), "{err}");
    }
}

/// The workspace helpers, against a real daemon. `serve` needs the `daemon`
/// feature, which the test matrix always enables alongside `daemon-client`.
#[cfg(all(test, feature = "daemon"))]
mod workspace_tests {
    use super::*;
    use crate::daemon::test_support::{start_op, Harness};

    /// Start a session in `workspace`, or unattributed for `None`.
    async fn start(client: &DaemonClient, harness: &Harness, id: &str, workspace: Option<&str>) {
        let mut op = start_op(id, harness.dir.path());
        if let Op::Start {
            ref mut workspace_id,
            ..
        } = op
        {
            *workspace_id = workspace.map(ToOwned::to_owned);
        }
        client.request(op).await.unwrap();
    }

    #[tokio::test]
    async fn liveness_is_the_set_of_attributed_sessions() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start(&client, &harness, "t1", Some("aaaa1111")).await;
        start(&client, &harness, "t2", Some("aaaa1111")).await;
        start(&client, &harness, "t3", Some("bbbb2222")).await;
        // Nothing routed this one; it belongs to no workspace and so keeps
        // none alive.
        start(&client, &harness, "t4", None).await;

        let live = client.live_workspaces().await.unwrap();
        assert_eq!(
            live.ids,
            ["aaaa1111".to_owned(), "bbbb2222".to_owned()]
                .into_iter()
                .collect()
        );
    }

    #[tokio::test]
    async fn a_workspaces_sessions_move_together() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start(&client, &harness, "ghost-1", Some("ghost")).await;
        start(&client, &harness, "ghost-2", Some("ghost")).await;
        start(&client, &harness, "other", Some("elsewhere")).await;

        let moved = client
            .reassign_sessions(&["ghost".to_owned()], "mine")
            .await
            .unwrap();
        assert_eq!(moved, 2);

        let live = client.live_workspaces().await.unwrap();
        assert_eq!(
            live.ids,
            ["mine".to_owned(), "elsewhere".to_owned()]
                .into_iter()
                .collect(),
            "the emptied workspace has no sessions left to keep it alive"
        );

        // Nothing to move is the common case, and costs no requests.
        assert_eq!(client.reassign_sessions(&[], "mine").await.unwrap(), 0);
        assert_eq!(
            client
                .reassign_sessions(&["nobody".to_owned()], "mine")
                .await
                .unwrap(),
            0
        );
    }
}
