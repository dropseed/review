//! Per-session VT screen-state actor and content peek.
//!
//! A terminal's raw PTY bytes carry escape sequences that only make sense once
//! replayed into a screen model (cursor moves, clears, colors). To answer "what
//! is on screen right now?" — the sidebar's content peek — we maintain a real
//! terminal grid per session and render it to plain text on demand.
//!
//! ## Why an actor thread
//!
//! The screen engine may be `!Send`, so it cannot be shared behind a mutex
//! across the reader thread and API callers.
//! Instead each session owns one dedicated **VT thread** ([`VtThread`]) that is
//! the sole owner of its engine. Everything reaches the engine by message:
//!
//! - [`VtOutputSink`] (an [`OutputSink`] on the PTY reader thread) forwards each
//!   raw chunk as [`VtMsg::Bytes`], and forwards EOF as [`VtMsg::Shutdown`].
//! - [`Session::resize`](super::Session::resize) forwards [`VtMsg::Resize`].
//! - [`VtThread::request_peek`] sends [`VtMsg::Peek`] with a reply channel, and
//!   the [`PendingPeek`] it hands back waits — bounded by [`PEEK_TIMEOUT`] —
//!   for the rendered screen. [`VtThread::peek`] is both in one call; keeping
//!   them separable is what lets a caller with many sessions to render put
//!   every request in flight before waiting on any of them, so N screens cost
//!   one timeout rather than N.
//!
//! Because the engine is constructed *on* the actor thread (via an
//! [`EngineFactory`] closure), a `!Send` engine never has to cross a thread
//! boundary — only the `Send` factory and the resulting `String` snapshots do.
//!
//! ## Backpressure
//!
//! The inbox is a **bounded** channel and the sink uses `try_send`: if the VT
//! thread ever falls behind (it should not — feeding the grid is cheap), raw
//! bytes are dropped for the *peek grid only* rather than stalling the reader
//! thread that drives the live terminal. The user-visible terminal (xterm.js)
//! and the scrollback ring are unaffected; a peek taken during such a lull is
//! merely slightly stale.
//!
//! ## Engine
//!
//! [`default_engine_factory`] builds a
//! [`GhosttyEngine`](super::engine_ghostty::GhosttyEngine) — Ghostty's own VT
//! core, so the peek and the visible terminal agree on wide characters, emoji,
//! and combining marks. It is `!Send`, which is what the actor thread above
//! exists to accommodate.
//!
//! The [`ScreenEngine`] trait stays a trait even with one real implementation:
//! the actor's own semantics — the peek timeout and the drop-on-full inbox —
//! can only be tested against an engine that blocks on command, which a real
//! Ghostty terminal cannot be made to do.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use bytes::Bytes;

use super::session::OutputSink;

/// How many messages the VT actor inbox holds before the sink drops bytes.
/// Generous: each message is a cheap handle (an `Arc`-backed [`Bytes`] or a few
/// integers), and the actor drains them far faster than a PTY produces them.
const VT_INBOX_CAPACITY: usize = 1024;

/// Hard cap on how long a peek waits for the actor to render the screen. Peeks
/// run from the reader thread (on a phase transition) and from API callers; both
/// must stay responsive, so a wedged or slow actor yields `None` rather than a
/// stall.
pub(super) const PEEK_TIMEOUT: Duration = Duration::from_millis(200);

/// A terminal screen model that can be fed raw PTY bytes and rendered to text.
///
/// **Not `Send`.** Implementations may hold thread-confined state (e.g. FFI
/// handles); the owning [`VtThread`] guarantees all calls happen on one thread.
/// Construct instances through an [`EngineFactory`] so `!Send` engines are never
/// moved across threads — only built in place on the actor thread.
pub trait ScreenEngine {
    /// Feed a chunk of raw PTY output into the screen model.
    fn feed(&mut self, bytes: &[u8]);
    /// Resize the screen model's grid.
    fn resize(&mut self, cols: u16, rows: u16);
    /// Render the current visible screen to plain text, one line per row,
    /// preceded by up to `scrollback` rows of the history immediately above it.
    ///
    /// `0` is the visible screen alone — the only thing the peek ever showed,
    /// and still what almost every caller wants. `u32::MAX` is everything the
    /// engine has retained.
    fn screen_text(&mut self, scrollback: u32) -> String;
}

/// Builds a [`ScreenEngine`] on the actor thread. The closure is `Send` (so it
/// can cross into the thread), but the engine it returns need not be.
pub type EngineFactory = Box<dyn FnOnce() -> Box<dyn ScreenEngine> + Send + 'static>;

/// A message to a session's VT actor thread.
enum VtMsg {
    /// Raw PTY output to feed into the screen model.
    Bytes(Bytes),
    /// Resize the grid to `cols` x `rows`.
    Resize(u16, u16),
    /// Render the screen — plus that many rows of history above it — and send
    /// it back on the reply channel.
    Peek(u32, SyncSender<String>),
    /// Stop the actor loop.
    Shutdown,
}

/// A session's VT actor: owns the screen engine on its own thread.
///
/// The session stores this handle to forward resizes, to render the screen on
/// demand ([`Self::peek`]), and to shut the thread down on teardown. The
/// [`VtOutputSink`] handed out by [`Self::output_sink`] holds a cloned sender
/// into the same inbox.
pub struct VtThread {
    tx: SyncSender<VtMsg>,
    handle: Option<JoinHandle<()>>,
}

impl VtThread {
    /// Spawn the actor thread, constructing its engine in place via `factory`.
    pub fn spawn(id: &str, factory: EngineFactory) -> Self {
        let (tx, rx) = sync_channel(VT_INBOX_CAPACITY);
        let handle = std::thread::Builder::new()
            .name(format!("terminal-vt-{id}"))
            .spawn(move || run(factory, &rx))
            .expect("failed to spawn terminal VT thread");
        Self {
            tx,
            handle: Some(handle),
        }
    }

    /// An [`OutputSink`] that forwards PTY output (and EOF) into this actor.
    pub fn output_sink(&self) -> VtOutputSink {
        VtOutputSink {
            tx: self.tx.clone(),
        }
    }

    /// Render the actor's current screen to plain text — with `scrollback`
    /// rows of history above it, or `0` for the visible screen alone — or
    /// `None` if unavailable (inbox full/actor gone, or the render didn't
    /// answer within [`PEEK_TIMEOUT`]). Safe to call from the reader thread or
    /// an API caller: it never blocks longer than the timeout.
    pub fn peek(&self, scrollback: u32) -> Option<String> {
        self.request_peek(scrollback)?
            .wait(Instant::now() + PEEK_TIMEOUT)
    }

    /// Ask the actor to render, without waiting for it. `None` if the request
    /// could not even be posted (inbox full, or the actor is gone).
    ///
    /// The half of [`Self::peek`] a caller rendering *many* sessions wants:
    /// each actor is its own thread, so their renders overlap, and waiting on
    /// each in turn would add up N independent timeouts for work that took the
    /// longest one.
    pub fn request_peek(&self, scrollback: u32) -> Option<PendingPeek> {
        let (reply_tx, reply_rx) = sync_channel(1);
        self.tx.try_send(VtMsg::Peek(scrollback, reply_tx)).ok()?;
        Some(PendingPeek { reply: reply_rx })
    }

    /// Forward a resize to the actor. Non-blocking; a dropped resize (full inbox)
    /// is corrected by the next chunk's reflow, so it never stalls the caller.
    pub fn send_resize(&self, cols: u16, rows: u16) {
        let _ = self.tx.try_send(VtMsg::Resize(cols, rows));
    }

    /// Stop the actor and join its thread. Idempotent per handle (consumes it).
    pub fn shutdown_and_join(mut self) {
        // The actor never blocks, so a blocking send here is safe and guarantees
        // the loop observes Shutdown even if the sink's earlier try_send was
        // dropped on a full inbox.
        let _ = self.tx.send(VtMsg::Shutdown);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// A render asked for and not yet collected.
///
/// Holding one costs nothing — the actor renders whether or not anybody is
/// waiting, and drops the answer if the receiver has gone.
pub struct PendingPeek {
    reply: Receiver<String>,
}

impl PendingPeek {
    /// The rendered screen, or `None` if it did not arrive by `deadline`.
    ///
    /// A *deadline* rather than a duration, so a batch of pending peeks can
    /// share one: the renders are already running in parallel, and each wait
    /// should only be for however much of the batch's budget is left.
    pub fn wait(self, deadline: Instant) -> Option<String> {
        self.reply
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .ok()
    }
}

/// The actor loop: build the engine, then service messages until shutdown.
fn run(factory: EngineFactory, rx: &Receiver<VtMsg>) {
    let mut engine = factory();
    while let Ok(msg) = rx.recv() {
        match msg {
            VtMsg::Bytes(bytes) => engine.feed(&bytes),
            VtMsg::Resize(cols, rows) => engine.resize(cols, rows),
            VtMsg::Peek(scrollback, reply) => {
                let screen = trim_screen(engine.screen_text(scrollback));
                // Reply buffer holds one; if the waiter has already timed out and
                // dropped its receiver, discard the render.
                let _ = reply.try_send(screen);
            }
            VtMsg::Shutdown => break,
        }
    }
}

/// Drop a rendered screen's trailing blank lines — the empty rows below the
/// last thing written, which are padding rather than content.
///
/// Nothing else is cut. The render is one line per visible row, so the grid's
/// own height is the only honest bound on it; a line cap on top of that reads
/// as a screen whose top rows are blank, which is how a short transcript drawn
/// at the top of a tall window (Claude Code's, with its prompt pinned to the
/// bottom) once peeked as nothing but the prompt box. Callers wanting less
/// take the tail themselves.
fn trim_screen(mut text: String) -> String {
    super::trim_trailing_blank_lines(&mut text);
    text
}

/// Forwards raw PTY output into a session's VT actor. Installed as an
/// [`OutputSink`] on the reader thread.
pub struct VtOutputSink {
    tx: SyncSender<VtMsg>,
}

impl OutputSink for VtOutputSink {
    fn on_output(&mut self, chunk: &[u8]) {
        // Drop-on-full: never stall the reader thread for the peek grid's sake.
        let _ = self
            .tx
            .try_send(VtMsg::Bytes(Bytes::copy_from_slice(chunk)));
    }

    fn on_exit(&mut self) {
        // Best-effort; the session also shuts the actor down and joins it.
        let _ = self.tx.try_send(VtMsg::Shutdown);
    }
}

/// Builds the screen engine each session's VT thread owns.
pub fn default_engine_factory(cols: u16, rows: u16) -> EngineFactory {
    Box::new(move || Box::new(super::engine_ghostty::GhosttyEngine::new(cols, rows)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// Records what the actor did, so tests can assert ordering and content.
    #[derive(Default)]
    struct FakeState {
        fed: Vec<u8>,
        last_resize: Option<(u16, u16)>,
        screen: String,
        /// The scrollback depth the last render was asked for.
        last_scrollback: Option<u32>,
        /// How long `screen_text` blocks — used to exercise the peek timeout.
        render_delay: Duration,
    }

    struct FakeEngine {
        state: Arc<Mutex<FakeState>>,
    }

    impl ScreenEngine for FakeEngine {
        fn feed(&mut self, bytes: &[u8]) {
            self.state.lock().unwrap().fed.extend_from_slice(bytes);
        }
        fn resize(&mut self, cols: u16, rows: u16) {
            self.state.lock().unwrap().last_resize = Some((cols, rows));
        }
        fn screen_text(&mut self, scrollback: u32) -> String {
            let (delay, screen) = {
                let mut s = self.state.lock().unwrap();
                s.last_scrollback = Some(scrollback);
                (s.render_delay, s.screen.clone())
            };
            if !delay.is_zero() {
                std::thread::sleep(delay);
            }
            screen
        }
    }

    fn spawn_fake(state: &Arc<Mutex<FakeState>>) -> VtThread {
        let state = Arc::clone(state);
        VtThread::spawn("test", Box::new(move || Box::new(FakeEngine { state })))
    }

    #[test]
    fn feed_resize_peek_flow() {
        let state = Arc::new(Mutex::new(FakeState {
            // No trailing blank line here: per-row whitespace trimming is the
            // engine's job; trim_screen only drops trailing blank *lines*.
            screen: "line one\nprompt>".to_owned(),
            ..FakeState::default()
        }));
        let vt = spawn_fake(&state);

        let mut sink = vt.output_sink();
        sink.on_output(b"hello ");
        sink.on_output(b"world");
        vt.send_resize(100, 40);

        let peeked = vt.peek(0).expect("peek should return the screen");
        assert_eq!(peeked, "line one\nprompt>");

        // The Peek reply proves all prior messages were drained in order.
        {
            let s = state.lock().unwrap();
            assert_eq!(s.fed, b"hello world");
            assert_eq!(s.last_resize, Some((100, 40)));
            assert_eq!(s.last_scrollback, Some(0));
        }

        // And the depth a caller asks for reaches the engine unchanged.
        vt.peek(u32::MAX).expect("peek should return the screen");
        assert_eq!(state.lock().unwrap().last_scrollback, Some(u32::MAX));

        vt.shutdown_and_join();
    }

    #[test]
    fn peek_times_out_when_render_is_slow() {
        let state = Arc::new(Mutex::new(FakeState {
            screen: "too slow".to_owned(),
            render_delay: PEEK_TIMEOUT * 3,
            ..FakeState::default()
        }));
        let vt = spawn_fake(&state);

        assert!(
            vt.peek(0).is_none(),
            "peek must time out when the actor renders too slowly"
        );

        vt.shutdown_and_join();
    }

    #[test]
    fn trim_drops_trailing_blanks_only() {
        // Trailing blank lines are dropped.
        assert_eq!(trim_screen("a\nb\n\n\n".to_owned()), "a\nb");
        // Interior blanks are preserved.
        assert_eq!(trim_screen("a\n\nb\n".to_owned()), "a\n\nb");
    }

    /// The 2026-08-17 regression: a short transcript at the top of a tall
    /// window with the prompt pinned to the bottom row. Everything above the
    /// prompt used to fall off the peek, which read as a stalled session.
    #[test]
    fn peek_keeps_the_top_of_a_tall_screen() {
        let vt = VtThread::spawn("tall", default_engine_factory(30, 50));
        let mut sink = vt.output_sink();
        sink.on_output(b"\x1b[2J\x1b[H");
        sink.on_output(b"top-marker\r\nsecond line\r\n");
        // Park the prompt on the last row, as a full-screen TUI does.
        sink.on_output(b"\x1b[50;1H> prompt");

        let peeked = vt.peek(0).expect("peek should return the screen");
        assert!(
            peeked.contains("top-marker"),
            "content above the old 40-line horizon was cut: {peeked:?}"
        );
        assert!(peeked.contains("> prompt"), "{peeked:?}");
        assert_eq!(peeked.lines().count(), 50, "{peeked:?}");

        vt.shutdown_and_join();
    }
}
