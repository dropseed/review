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
use libghostty_vt::screen::GridRef;
use libghostty_vt::selection::Selection;
use libghostty_vt::terminal::{Options, Point, PointCoordinate, PointSpace, Terminal};

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

    /// Render the visible viewport to plain text, preceded by up to
    /// `scrollback` rows of the history immediately above it.
    ///
    /// Scoped with a selection because the formatter otherwise renders the
    /// whole screen *including all scrollback*, which the caller would
    /// immediately throw away — and pays for: on a full 120x40 grid that is
    /// ~13x the time and ~14x the bytes of the viewport-scoped render. That
    /// cost is exactly what a caller asking for `n` rows of history is choosing
    /// to pay, in the amount it chose.
    fn render(&self, scrollback: u32) -> Result<String> {
        let cols = self.term.cols()?;
        let rows = self.term.rows()?;
        let start = self.start_ref(scrollback)?;
        let end = self.term.grid_ref(Point::Viewport(PointCoordinate {
            x: cols.saturating_sub(1),
            y: u32::from(rows.saturating_sub(1)),
        }))?;

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

    /// The top-left cell a render starts at: the viewport's own first row, or
    /// `scrollback` rows above it.
    ///
    /// History has no viewport coordinate — that space only covers what is
    /// visible — so this crosses into *screen* space, which numbers every row
    /// the grid still holds from the oldest scrollback row down. Asking the
    /// viewport's first row for its screen coordinate is asking how many rows
    /// of history exist, and subtracting saturates: `u32::MAX` means "all of
    /// it" for free, and a shallower history than requested yields all of that.
    ///
    /// `scrollback == 0` never touches any of this. It resolves the same
    /// viewport point the peek has always used, so the visible-screen render
    /// stays byte-for-byte what it was.
    fn start_ref(&self, scrollback: u32) -> Result<GridRef<'_>> {
        let viewport_top = Point::Viewport(PointCoordinate { x: 0, y: 0 });
        if scrollback == 0 {
            return self.term.grid_ref(viewport_top);
        }
        let top = self.term.grid_ref(viewport_top)?;
        // A viewport row is always representable in screen space; treat the
        // impossible `None` as "no history to show" rather than an error.
        let Some(on_screen) = self.term.point_from_grid_ref(&top, PointSpace::Screen)? else {
            return self.term.grid_ref(viewport_top);
        };
        self.term.grid_ref(Point::Screen(PointCoordinate {
            x: 0,
            y: on_screen.y.saturating_sub(scrollback),
        }))
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

    fn screen_text(&mut self, scrollback: u32) -> String {
        // A failed render yields an empty peek rather than a stalled one — but
        // say so, or an empty peek is indistinguishable from a blank screen.
        self.render(scrollback).unwrap_or_else(|error| {
            log::debug!("[peek] render of {scrollback} scrollback rows failed: {error:?}");
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
        let screen = engine.screen_text(0);
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
        let screen = engine.screen_text(0);
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
        let _ = engine.screen_text(0);
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
        let screen = engine.screen_text(0);

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
        let screen = engine.screen_text(0);
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

    /// The sibling of the test above: asked for history, the same grid gives up
    /// the rows that scrolled off — in order, above the viewport, and only as
    /// many as were asked for.
    #[test]
    fn renders_history_above_the_viewport_on_request() {
        let mut engine = GhosttyEngine::new(30, 5);
        for i in 1..=12 {
            engine.feed(format!("line {i}\r\n").as_bytes());
        }

        // Three rows of history, then the visible screen.
        let some = engine.screen_text(3);
        assert!(
            some.contains("line 12"),
            "the visible screen must still be there: {some:?}"
        );
        assert!(
            !some.contains("line 4\n"),
            "reached further back than asked: {some:?}"
        );
        assert_eq!(
            some.lines().count(),
            engine.screen_text(0).lines().count() + 3,
            "asked for 3 rows of history and got something else: {some:?}"
        );

        // Everything the grid still holds, oldest first.
        let all = engine.screen_text(u32::MAX);
        assert!(
            all.contains("line 1\n") && all.contains("line 12"),
            "the full history is missing rows: {all:?}"
        );
        let first = all.lines().next().unwrap_or_default();
        assert_eq!(
            first.trim(),
            "line 1",
            "history came back out of order: {all:?}"
        );

        // A grid with nothing scrolled off answers the viewport, whatever it
        // is asked for — no error, no invented blank rows.
        let mut fresh = GhosttyEngine::new(30, 5);
        fresh.feed(b"only line\r\n");
        assert_eq!(fresh.screen_text(u32::MAX), fresh.screen_text(0));
    }
}
