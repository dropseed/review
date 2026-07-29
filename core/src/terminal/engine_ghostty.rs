//! [`ScreenEngine`] backed by `libghostty-vt` — the terminal core extracted from
//! Ghostty itself.
//!
//! The peek grid's whole job is answering "what is this agent asking me?", and
//! agents draw full-screen TUIs out of wide characters, emoji, and combining
//! sequences — exactly where screen models disagree. Running Ghostty's own VT
//! here, and its own plain-text formatter to render it, makes the peek agree
//! with the visible terminal by construction rather than by coincidence.
//!
//! The library is `!Send` (the C API may use thread-local state), which is why
//! [`VtThread`](super::vt::VtThread) builds its engine *on* the actor thread
//! through a factory instead of moving one across a thread boundary.
//!
//! ## Build
//!
//! This links a native library built from the `vendor/ghostty` submodule by
//! zig, so a Zig toolchain is required to build the `terminal` feature. See
//! `.cargo/config.toml` for how the source directory is wired up, and
//! `scripts/install` for the toolchain check.

use libghostty_vt::error::Result;
use libghostty_vt::fmt::{Format, Formatter, FormatterOptions};
use libghostty_vt::selection::Selection;
use libghostty_vt::terminal::{Options, Point, PointCoordinate, Terminal};

use super::vt::ScreenEngine;

/// Off-screen scrollback retained by the grid, **in bytes** — not lines, despite
/// what the C header's comment says. Ghostty routes this to `PageList`'s
/// `max_size` and then clamps it *up* to roughly 1 MiB, so every value between 1
/// and that floor behaves identically; asking for 0 is the only way to actually
/// get less. We ask for the floor deliberately: the peek renders only the
/// visible screen, but keeping a page of history is what lets rows scroll back
/// into view when the grid is later enlarged.
const SCROLLBACK_BYTES: usize = 1024 * 1024;

/// Clamp to at least 1x1: Ghostty rejects a zero-sized grid.
fn clamp_grid(cols: u16, rows: u16) -> (u16, u16) {
    (cols.max(1), rows.max(1))
}

/// A screen engine over a Ghostty terminal.
pub struct GhosttyEngine {
    term: Terminal<'static, 'static>,
}

impl GhosttyEngine {
    /// Build an engine sized to `cols` x `rows`.
    ///
    /// # Panics
    ///
    /// If Ghostty refuses to build the terminal — in practice only allocation
    /// failure, since [`clamp_grid`] rules out the invalid-dimension case. This
    /// runs on the session's VT thread, so the blast radius is the content peek
    /// for that one session; the terminal itself and its scrollback are
    /// unaffected.
    pub fn new(cols: u16, rows: u16) -> Self {
        let (cols, rows) = clamp_grid(cols, rows);
        Self {
            term: Terminal::new(Options {
                cols,
                rows,
                max_scrollback: SCROLLBACK_BYTES,
            })
            .expect("failed to allocate the peek terminal"),
        }
    }

    /// Render the visible viewport to plain text.
    ///
    /// Scoped with a selection because the formatter otherwise renders the
    /// whole screen *including scrollback*, which the caller would immediately
    /// throw away — and pays for: on a full 120x40 grid that is ~13x the time
    /// and ~14x the bytes of the viewport-scoped render.
    fn render_viewport(&self) -> Result<String> {
        let cols = self.term.cols()?;
        let rows = self.term.rows()?;
        let viewport = |x, y| Point::Viewport(PointCoordinate { x, y });
        let start = self.term.grid_ref(viewport(0, 0))?;
        let end = self.term.grid_ref(viewport(
            cols.saturating_sub(1),
            u32::from(rows.saturating_sub(1)),
        ))?;

        let selection = Selection::new(start, end, false);
        let options = FormatterOptions::new()
            .with_format(Format::Plain)
            .with_trim(true)
            // Soft-wrapped lines stay wrapped: the peek shows the screen as the
            // user sees it, not the logical lines behind it.
            .with_unwrap(false)
            .with_selection(&selection);

        let mut formatter = Formatter::new(&self.term, options)?;
        let bytes = formatter.format_alloc(None)?;
        // Borrowed for valid UTF-8, so this is the single unavoidable copy:
        // `bytes` is freed by Ghostty's allocator when it drops.
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }
}

impl ScreenEngine for GhosttyEngine {
    fn feed(&mut self, bytes: &[u8]) {
        // Never fails: malformed input is logged internally and cannot corrupt
        // terminal state.
        self.term.vt_write(bytes);
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        let (cols, rows) = clamp_grid(cols, rows);
        // Cell pixel dimensions only matter for image protocols and size
        // reports, neither of which the peek grid uses.
        if let Err(error) = self.term.resize(cols, rows, 0, 0) {
            log::debug!("[peek] resize to {cols}x{rows} failed: {error:?}");
        }
    }

    fn screen_text(&mut self) -> String {
        // A failed render yields an empty peek rather than a stalled one — but
        // say so, or an empty peek is indistinguishable from a blank screen.
        self.render_viewport().unwrap_or_else(|error| {
            log::debug!("[peek] render failed: {error:?}");
            String::new()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_prompt_without_escape_sequences() {
        let mut engine = GhosttyEngine::new(80, 24);
        // A yes/no prompt with a color SGR and a cursor move mixed in.
        engine.feed(b"\x1b[32mDo you want to proceed? (y/n)\x1b[0m\r\n");
        engine.feed(b"\x1b[1;1H"); // move cursor home — must not corrupt text
        let screen = engine.screen_text();
        assert!(
            screen.contains("Do you want to proceed? (y/n)"),
            "prompt text missing from screen: {screen:?}"
        );
        assert!(
            !screen.contains('\x1b'),
            "escape bytes leaked into screen text"
        );
        assert!(
            !screen.contains("[32m"),
            "SGR params leaked into screen text"
        );
    }

    #[test]
    fn later_writes_overwrite_via_cursor_moves() {
        let mut engine = GhosttyEngine::new(80, 24);
        engine.feed(b"first line\r\nsecond line");
        // Carriage return to line start, overwrite "second".
        engine.feed(b"\rSECOND");
        let screen = engine.screen_text();
        assert!(screen.contains("first line"));
        assert!(screen.contains("SECOND line"));
        assert!(!screen.contains("second line"));
    }

    #[test]
    fn resize_reflow_does_not_panic() {
        let mut engine = GhosttyEngine::new(80, 24);
        engine.feed(b"some content that will need to reflow when the grid shrinks\r\n");
        engine.resize(20, 10);
        engine.resize(120, 40);
        engine.resize(1, 1); // extreme, but must be clamped and safe
        let _ = engine.screen_text();
    }

    /// The reason this engine exists. A naive cell-by-cell walk of a grid drops
    /// combining marks and pads wide characters with the spacer cells that sit
    /// behind them; Ghostty's own formatter reproduces what is on screen.
    #[test]
    fn preserves_wide_characters_emoji_and_combining_marks() {
        let mut engine = GhosttyEngine::new(60, 8);
        engine.feed("\u{65E5}\u{672C}\u{8A9E} text\r\n".as_bytes());
        engine
            .feed("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} \u{1F44B}\u{1F3FD}\r\n".as_bytes());
        engine.feed("e\u{0301}gale\u{0301} a\u{0308}o\u{0308}u\u{0308}\r\n".as_bytes());
        let screen = engine.screen_text();

        // Wide characters are not split by spacer cells.
        assert!(
            screen.contains("\u{65E5}\u{672C}\u{8A9E} text"),
            "wide characters mangled: {screen:?}"
        );
        // A ZWJ family stays one cluster, and the skin-tone modifier stays
        // attached to the hand it modifies.
        assert!(
            screen.contains("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} \u{1F44B}\u{1F3FD}"),
            "emoji clusters broken apart: {screen:?}"
        );
        // Combining marks survive instead of being dropped with the cell extras.
        assert!(
            screen.contains("e\u{0301}gale\u{0301} a\u{0308}o\u{0308}u\u{0308}"),
            "combining marks lost: {screen:?}"
        );
    }

    /// The peek is the *visible* screen. Without an explicit viewport scope the
    /// formatter renders scrollback too, which would bury the current prompt.
    #[test]
    fn renders_only_the_visible_viewport() {
        let mut engine = GhosttyEngine::new(30, 5);
        for i in 1..=12 {
            engine.feed(format!("line {i}\r\n").as_bytes());
        }
        let screen = engine.screen_text();
        assert!(
            !screen.contains("line 1\n"),
            "scrolled-off rows leaked into the peek: {screen:?}"
        );
        assert!(
            screen.contains("line 12"),
            "the newest row is missing: {screen:?}"
        );
        assert!(
            screen.lines().count() <= 5,
            "peek exceeded the visible grid: {screen:?}"
        );
    }
}
