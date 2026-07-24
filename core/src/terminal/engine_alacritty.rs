//! Default [`ScreenEngine`] backed by `alacritty_terminal`.
//!
//! Pure Rust with no native toolchain, so it builds on every platform. Compiled
//! with the `terminal` feature and built by [`super::vt::default_engine_factory`].
//!
//! Note: `alacritty_terminal` pulls in its own `vte` version for ANSI parsing,
//! which differs from this crate's direct `vte` dependency used by the status
//! scanner. Cargo resolves both side by side; they are unrelated.

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte::ansi::Processor;

use super::vt::ScreenEngine;

/// Off-screen scrollback retained by the grid. Content peek only renders the
/// visible screen; a modest history just avoids clipping during reflow.
const SCROLLBACK_LINES: usize = 1000;

/// Grid dimensions for `alacritty_terminal`. History is configured separately
/// via [`Config::scrolling_history`], so `total_lines` mirrors the visible
/// height (matching the crate's own `TermSize`).
#[derive(Clone, Copy)]
struct GridSize {
    columns: usize,
    screen_lines: usize,
}

impl GridSize {
    /// Clamp to at least 1x1: a zero-sized grid would panic inside the crate.
    fn new(cols: u16, rows: u16) -> Self {
        Self {
            columns: usize::from(cols).max(1),
            screen_lines: usize::from(rows).max(1),
        }
    }
}

impl Dimensions for GridSize {
    fn total_lines(&self) -> usize {
        self.screen_lines
    }
    fn screen_lines(&self) -> usize {
        self.screen_lines
    }
    fn columns(&self) -> usize {
        self.columns
    }
}

/// A screen engine over an `alacritty_terminal` grid and its ANSI parser.
pub struct AlacrittyEngine {
    term: Term<VoidListener>,
    parser: Processor,
}

impl AlacrittyEngine {
    /// Build an engine sized to `cols` x `rows`.
    pub fn new(cols: u16, rows: u16) -> Self {
        let size = GridSize::new(cols, rows);
        let config = Config {
            scrolling_history: SCROLLBACK_LINES,
            ..Config::default()
        };
        Self {
            // A void listener discards terminal events (bell, title, clipboard):
            // status tracking lives in the vte scanner, not here.
            term: Term::new(config, &size, VoidListener),
            parser: Processor::new(),
        }
    }
}

impl ScreenEngine for AlacrittyEngine {
    fn feed(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        self.term.resize(GridSize::new(cols, rows));
    }

    fn screen_text(&mut self) -> String {
        let grid = self.term.grid();
        let columns = grid.columns();
        let screen_lines = grid.screen_lines();
        let mut out = String::new();
        // Display offset is always 0 (we never scroll back), so Line(0)..
        // Line(screen_lines) are exactly the visible rows.
        for line in 0..screen_lines {
            // A terminal never has more rows than fit in an i32; bail defensively
            // rather than wrap the cast.
            let Ok(line_index) = i32::try_from(line) else {
                break;
            };
            let row = &grid[Line(line_index)];
            let mut text = String::with_capacity(columns);
            for col in 0..columns {
                text.push(row[Column(col)].c);
            }
            out.push_str(text.trim_end());
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_prompt_without_escape_sequences() {
        let mut engine = AlacrittyEngine::new(80, 24);
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
        let mut engine = AlacrittyEngine::new(80, 24);
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
        let mut engine = AlacrittyEngine::new(80, 24);
        engine.feed(b"some content that will need to reflow when the grid shrinks\r\n");
        engine.resize(20, 10);
        engine.resize(120, 40);
        engine.resize(1, 1); // extreme, but must be clamped and safe
        let _ = engine.screen_text();
    }
}
