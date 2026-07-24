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
//! - [`VtThread::peek`] sends [`VtMsg::Peek`] with a reply channel and waits,
//!   bounded by [`PEEK_TIMEOUT`], for the rendered screen.
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
//! [`default_engine_factory`] builds an
//! [`AlacrittyEngine`](super::engine_alacritty::AlacrittyEngine) — pure Rust, no
//! native toolchain, builds on every platform.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread::JoinHandle;
use std::time::Duration;

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
const PEEK_TIMEOUT: Duration = Duration::from_millis(200);

/// Keep a peek snapshot popover-sized: the last this-many non-blank screen rows.
const PEEK_MAX_LINES: usize = 40;

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
    /// Render the current visible screen to plain text, one line per row.
    fn screen_text(&mut self) -> String;
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
    /// Render the screen and send it back on the reply channel.
    Peek(SyncSender<String>),
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

    /// Render the actor's current screen to plain text, or `None` if
    /// unavailable (inbox full/actor gone, or the render didn't answer within
    /// [`PEEK_TIMEOUT`]). Safe to call from the reader thread or an API caller:
    /// it never blocks longer than the timeout.
    pub fn peek(&self) -> Option<String> {
        let (reply_tx, reply_rx) = sync_channel(1);
        self.tx.try_send(VtMsg::Peek(reply_tx)).ok()?;
        reply_rx.recv_timeout(PEEK_TIMEOUT).ok()
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

/// The actor loop: build the engine, then service messages until shutdown.
fn run(factory: EngineFactory, rx: &Receiver<VtMsg>) {
    let mut engine = factory();
    while let Ok(msg) = rx.recv() {
        match msg {
            VtMsg::Bytes(bytes) => engine.feed(&bytes),
            VtMsg::Resize(cols, rows) => engine.resize(cols, rows),
            VtMsg::Peek(reply) => {
                let screen = engine.screen_text();
                // Reply buffer holds one; if the waiter has already timed out and
                // dropped its receiver, discard the render.
                let _ = reply.try_send(trim_screen(&screen));
            }
            VtMsg::Shutdown => break,
        }
    }
}

/// Trim a rendered screen for a popover-sized peek: drop trailing blank lines,
/// then keep only the last [`PEEK_MAX_LINES`] lines.
fn trim_screen(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let end = lines
        .iter()
        .rposition(|line| !line.trim().is_empty())
        .map_or(0, |i| i + 1);
    let kept = &lines[..end];
    let start = kept.len().saturating_sub(PEEK_MAX_LINES);
    kept[start..].join("\n")
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
    Box::new(move || Box::new(super::engine_alacritty::AlacrittyEngine::new(cols, rows)))
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
        fn screen_text(&mut self) -> String {
            let (delay, screen) = {
                let s = self.state.lock().unwrap();
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

        let peeked = vt.peek().expect("peek should return the screen");
        assert_eq!(peeked, "line one\nprompt>");

        // The Peek reply proves all prior messages were drained in order.
        {
            let s = state.lock().unwrap();
            assert_eq!(s.fed, b"hello world");
            assert_eq!(s.last_resize, Some((100, 40)));
        }

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
            vt.peek().is_none(),
            "peek must time out when the actor renders too slowly"
        );

        vt.shutdown_and_join();
    }

    #[test]
    fn trim_drops_trailing_blanks_and_caps_lines() {
        // Trailing blank lines are dropped.
        assert_eq!(trim_screen("a\nb\n\n\n"), "a\nb");
        // Interior blanks are preserved.
        assert_eq!(trim_screen("a\n\nb\n"), "a\n\nb");

        // Capped to the last PEEK_MAX_LINES lines.
        let many = (0..PEEK_MAX_LINES + 10)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let trimmed = trim_screen(&many);
        assert_eq!(trimmed.lines().count(), PEEK_MAX_LINES);
        assert!(trimmed.starts_with("10\n"));
        assert!(trimmed.ends_with(&(PEEK_MAX_LINES + 9).to_string()));
    }
}
