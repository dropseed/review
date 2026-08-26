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
use super::protocol::{
    Event, Hello, Op, OpResult, Request, Response, StreamFrame, VersionInfo, B64,
};

/// Buffered [`StreamFrame`]s per open stream before the reader task blocks.
/// Matches the daemon-side subscriber bound, so back-pressure surfaces there
/// (where re-subscribe recovery lives) rather than here.
const STREAM_CHANNEL_CAPACITY: usize = 1024;

/// Buffered [`Event`]s before the events reader task blocks. Smaller than a
/// stream's: these are per-daemon lifecycle transitions, not PTY output, and a
/// consumer this far behind is one the daemon will shortly call lagged anyway.
const EVENTS_CHANNEL_CAPACITY: usize = 256;

// The three ways the *transport* dies, as they appear in an error chain.
//
// Callers tell "the connection is gone" apart from "the daemon says no" by
// matching these (see `crate::server`'s `is_disconnected`), which is only safe
// while both sides name the same string — so both sides name the same const,
// and drift is a compile error rather than a bridge that silently stops
// reconnecting.

/// Dialing the socket failed. Carries ` at <path>` after it at the call site.
pub const ERR_CONNECTING: &str = "connecting to daemon";
/// Writing a request frame onto the control connection failed.
pub const ERR_SENDING: &str = "sending request to daemon";
/// The control connection ended with a request still in flight.
pub const ERR_CLOSED: &str = "daemon connection closed before responding";

/// Requests awaiting a response, keyed by request id.
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<OpResult>>>>;

/// The fields of a `TerminalSummary` this module's workspace helpers use.
/// Deserializing the subset keeps the client free of `crate::terminal`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribution {
    id: String,
    workspace_id: Option<String>,
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
            .with_context(|| format!("{ERR_CONNECTING} at {}", socket.display()))?;
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

    /// Whether these two handles are clones of the *same* connection.
    ///
    /// A clone is cheap because it shares one [`Inner`], so identity is `Arc`
    /// identity. Callers that cache a client use this before throwing a dead one
    /// away: two tasks can fail on the same connection at once, and the second
    /// must not evict the healthy replacement the first already installed.
    pub fn is_same_connection(&self, other: &DaemonClient) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
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
            return Err(e).context(ERR_SENDING);
        }

        match rx.await {
            Ok(OpResult::Ok(value)) => Ok(value),
            Ok(OpResult::Err(message)) => Err(anyhow!(message)),
            Err(_) => Err(anyhow!(ERR_CLOSED)),
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

    /// Every workspace with at least one live session.
    ///
    /// The liveness half of [`crate::work::cleanup`]: the queue is this
    /// process's to read, but "is anything running in it?" is only the daemon's
    /// to answer, and a caller that cannot reach the daemon must not guess.
    pub async fn live_workspaces(&self) -> Result<HashSet<String>> {
        Ok(self
            .attributions()
            .await?
            .into_iter()
            .filter_map(|session| session.workspace_id)
            .collect())
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
            .map(|session| session.id)
            .collect::<Vec<_>>();

        // The assignments are independent of each other, so they go out
        // together rather than one round trip after another — moving a
        // workspace with several shells in it is one wait, not n.
        let sending = moving
            .iter()
            .map(|id| self.assign_workspace(id, Some(to.to_owned())));
        for result in futures::future::join_all(sending).await {
            result?;
        }
        Ok(moving.len())
    }

    /// Move one session onto a workspace, or off every workspace.
    ///
    /// The workspace id is opaque to the daemon, so this writes nothing to the
    /// queue — a caller that means a real workspace resolves it first.
    pub async fn assign_workspace(
        &self,
        terminal_id: &str,
        workspace_id: Option<String>,
    ) -> Result<()> {
        self.request(Op::AssignWorkspace {
            terminal_id: terminal_id.to_owned(),
            workspace_id,
        })
        .await
        .map(|_| ())
    }

    /// Every session as `(id, workspace)`. Decoded into a local shape rather
    /// than `TerminalSummary` to keep this module free of `crate::terminal`.
    pub async fn attributions(&self) -> Result<Vec<Attribution>> {
        self.request_as(Op::List { repo_path: None }).await
    }

    /// Who the daemon is, what wire it speaks, and which named capabilities it
    /// serves — the desktop weighs all three to decide between attaching and
    /// respawning. See [`VersionInfo::has_features`].
    ///
    /// [`VersionInfo::has_features`]: super::protocol::VersionInfo::has_features
    pub async fn version(&self) -> Result<VersionInfo> {
        VersionInfo::from_payload(self.request(Op::Version).await?)
    }

    /// One session's visible screen, as its VT engine renders it.
    ///
    /// `scrollback` is how many rows of history to include above the visible
    /// screen: `0` is the screen alone, `u32::MAX` everything the daemon still
    /// holds. Needs the `peek-scrollback` feature for anything but `0` — an
    /// older daemon parses the request and ignores the field, answering with
    /// the viewport.
    pub async fn peek_with(&self, terminal_id: &str, scrollback: u32) -> Result<String> {
        self.request_as(Op::Peek {
            terminal_id: terminal_id.to_owned(),
            scrollback,
        })
        .await
    }

    /// Many sessions' visible screens in one round trip, keyed by id. Ids the
    /// daemon does not know are absent from the map rather than an error.
    /// Needs the `peek-many` feature.
    pub async fn peek_many(&self, terminal_ids: &[String]) -> Result<HashMap<String, String>> {
        self.request_as(Op::PeekMany {
            terminal_ids: terminal_ids.to_vec(),
        })
        .await
    }

    /// Open a second connection carrying one session's live output.
    ///
    /// The returned handle is a dumb pump: loop on [`StreamHandle::recv`] until
    /// it yields `None`. Dropping it closes the connection, which drops the
    /// daemon-side subscription — it never kills the session.
    pub async fn open_stream(&self, terminal_id: &str) -> Result<StreamHandle> {
        self.open_channel(
            Hello::Stream {
                terminal_id: terminal_id.to_owned(),
            },
            STREAM_CHANNEL_CAPACITY,
            StreamFrame::decode,
        )
        .await
    }

    /// Open a second connection carrying every session's lifecycle.
    ///
    /// One of these per client is enough — it covers every session, including
    /// ones this client never started. Pair it with an [`Op::List`] taken
    /// *after* it opens and the two are always the current list; an
    /// [`Event::Lagged`] says that guarantee lapsed and to list again.
    ///
    /// Needs the daemon to serve the `events` feature; against one that does
    /// not, the hello frame is simply not understood and the connection ends
    /// without frames.
    pub async fn open_events(&self) -> Result<EventsHandle> {
        self.open_channel(Hello::Events, EVENTS_CHANNEL_CAPACITY, Event::decode)
            .await
    }

    /// Dial a second connection, claim a one-way role with `hello`, and pump
    /// its decoded frames into a [`Channel`].
    ///
    /// Both one-way roles are this same pump, so both invariants live here
    /// once: the write half is **held open** for the connection's lifetime
    /// (the daemon watches it for EOF to notice a detached client), and an
    /// undecodable frame is **skipped, not fatal** — the length prefix has
    /// already resynced us to the next frame, and a frame this build cannot
    /// read is most likely a newer daemon's, so ending the connection over one
    /// would turn every protocol addition into a hard break for old clients.
    async fn open_channel<T: Send + 'static>(
        &self,
        hello: Hello,
        capacity: usize,
        decode: fn(&[u8]) -> Result<T>,
    ) -> Result<Channel<T>> {
        let socket = &self.inner.socket;
        let stream = UnixStream::connect(socket)
            .await
            .with_context(|| format!("{ERR_CONNECTING} at {}", socket.display()))?;
        let (mut read_half, mut write_half) = stream.into_split();

        let hello = serde_json::to_vec(&hello)?;
        write_frame(&mut write_half, &hello).await?;

        let (tx, rx) = mpsc::channel(capacity);
        let task = tokio::spawn(async move {
            // Held, not dropped — see this function's docs.
            let _write_half = write_half;
            while let Ok(Some(body)) = read_frame(&mut read_half).await {
                match decode(&body) {
                    Ok(frame) => {
                        if tx.send(frame).await.is_err() {
                            return; // consumer went away
                        }
                    }
                    Err(e) => log::warn!("[daemon client] skipping malformed frame: {e}"),
                }
            }
        });

        Ok(Channel { rx, task })
    }
}

/// A live stream of every session's [`Event`]s.
pub type EventsHandle = Channel<Event>;

/// A live stream of one session's [`StreamFrame`]s.
pub type StreamHandle = Channel<StreamFrame>;

/// One of the daemon's one-way channels: a receiver fed by a reader task that
/// owns the connection. Dropping it closes the connection.
#[derive(Debug)]
pub struct Channel<T> {
    rx: mpsc::Receiver<T>,
    task: tokio::task::JoinHandle<()>,
}

impl<T> Channel<T> {
    /// The next frame, or `None` once the connection ended.
    ///
    /// For a [`StreamHandle`] that means the daemon closed the stream (after a
    /// [`StreamFrame::Exit`] or [`StreamFrame::Error`]) or the connection
    /// died; for an [`EventsHandle`], only that the daemon went away, since
    /// nothing on that channel is terminal — reconnect, then re-list.
    pub async fn recv(&mut self) -> Option<T> {
        self.rx.recv().await
    }
}

impl<T> Drop for Channel<T> {
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
            live,
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
            live,
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
