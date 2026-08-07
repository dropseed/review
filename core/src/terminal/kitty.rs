//! The negotiated half of the kitty keyboard protocol: the mode stack a program
//! pushes, pops and queries.
//!
//! Legacy terminal key encoding is lossy: Enter, Ctrl+M and Ctrl+Enter all
//! arrive as `\r`, and Shift+Enter is indistinguishable from Enter. Under this
//! protocol a program asks for unambiguous keys and every modified key arrives
//! as `CSI <key> ; <modifiers> u`. It is opt-in per program and stack-based, so
//! a TUI can enable it, a child process can push its own setting, and popping
//! restores whatever the parent had.
//!
//! The stack is per screen buffer, which is the protocol's safety net rather
//! than a detail: a full-screen program does its work on the alternate screen,
//! so whatever it pushes there — and forgets to pop, or never gets the chance to
//! pop because it was killed — cannot follow the shell back to the main screen.
//!
//! This lives in the daemon, next to the [`vte::Parser`] that already reads
//! every PTY byte ([`super::status`]), rather than in the window drawing the
//! terminal. The negotiation is a property of the *session*: it survives a
//! window closing and reopening, it is the same answer for two windows showing
//! one terminal, and a program that pushed its mode long ago must still be
//! encoded for after the push has scrolled out of the replay ring. Only the
//! *encoder* is frontend work, because it needs a DOM `KeyboardEvent`.
//!
//! Reference: the protocol as implemented by Ghostty (`src/terminal/kitty/key.zig`).

/// Flags are five bits; anything wider is a malformed request.
pub const FLAGS_MAX: u16 = 31;

/// How deep the mode stack goes before the oldest entry is dropped. Programs
/// push on entry and pop on exit; a leaked push must not be able to grow this
/// without bound, so it wraps rather than allocating.
const STACK_DEPTH: usize = 8;

/// Which buffer a terminal is showing. Each keeps its own mode stack.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Normal,
    Alternate,
}

/// The per-session mode stacks, one per screen buffer.
#[derive(Debug)]
pub struct KittyKeyboard {
    normal: Vec<u8>,
    alternate: Vec<u8>,
    screen: Screen,
}

impl Default for KittyKeyboard {
    fn default() -> Self {
        Self {
            normal: vec![0],
            alternate: vec![0],
            screen: Screen::Normal,
        }
    }
}

impl KittyKeyboard {
    /// The flags currently in force, 0 when the protocol is off.
    pub fn flags(&self) -> u8 {
        self.stack().last().copied().unwrap_or(0)
    }

    fn stack(&self) -> &Vec<u8> {
        match self.screen {
            Screen::Normal => &self.normal,
            Screen::Alternate => &self.alternate,
        }
    }

    fn stack_mut(&mut self) -> &mut Vec<u8> {
        match self.screen {
            Screen::Normal => &mut self.normal,
            Screen::Alternate => &mut self.alternate,
        }
    }

    /// Follow the terminal onto the other screen buffer.
    ///
    /// The stacks do not merge and the one being left is not cleared: a program
    /// that drops to the main screen to run a child and comes back expects to
    /// find its own mode still in force. What it cannot do is impose that mode
    /// on the shell.
    pub fn set_screen(&mut self, screen: Screen) {
        self.screen = screen;
    }

    /// `CSI > flags u` — push a level. Bits above the five the protocol defines
    /// are masked rather than refused: dropping the push while still honouring
    /// the program's later pop would unwind a level it never pushed, taking the
    /// shell's mode with it. Ghostty masks for the same reason.
    pub fn push(&mut self, flags: u16) {
        let flags = u8::try_from(flags & FLAGS_MAX).unwrap_or(0);
        let stack = self.stack_mut();
        stack.push(flags);
        // Wrap rather than grow: drop the oldest entry once we exceed the depth.
        if stack.len() > STACK_DEPTH {
            stack.remove(0);
        }
    }

    /// `CSI < n u` — pop `count` levels.
    pub fn pop(&mut self, count: u16) {
        let stack = self.stack_mut();
        // A pop deeper than the stack is a program losing track of its own
        // state; treat it as "put everything back" rather than half-unwinding.
        if usize::from(count) >= STACK_DEPTH {
            stack.clear();
            stack.push(0);
            return;
        }
        for _ in 0..count {
            if stack.len() > 1 {
                stack.pop();
            } else {
                stack[0] = 0;
            }
        }
    }

    /// `CSI = flags ; mode u` — set/or/clear in place. Modes outside 1..3 are
    /// malformed; leaving the state alone beats guessing, since a garbled
    /// sequence would otherwise silently change key encoding.
    pub fn set(&mut self, flags: u16, mode: u16) {
        if flags > FLAGS_MAX {
            return;
        }
        let flags = u8::try_from(flags).unwrap_or(0);
        let stack = self.stack_mut();
        let Some(top) = stack.last_mut() else { return };
        match mode {
            1 => *top = flags,
            2 => *top |= flags,
            3 => *top &= !flags,
            _ => {}
        }
    }

    /// Reset to "off" on both screens, back on the main one. A full terminal
    /// reset (RIS, `ESC c`) or a soft reset (DECSTR, `CSI ! p`) clears the mode;
    /// `reset` is how a user recovers a terminal whose keyboard is encoded for a
    /// protocol nothing is reading.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Zero both stacks without touching which screen is active — the screen
    /// keeps tracking the program's buffer, only the flags are declared dead.
    ///
    /// Called at a shell prompt (OSC 133;A). An interactive prompt means the
    /// shell owns the terminal: no full-screen program is alive, so flags still
    /// set on *either* screen were leaked by a program that died without
    /// popping. The per-screen stacks stop such a leak reaching the shell, but
    /// the alternate screen's copy would otherwise wait there for the next
    /// vim/less, which inherits the dead program's mode as keys it cannot parse.
    /// Kitty's own shell integration performs the same reset at each prompt.
    ///
    /// The accepted cost, same as kitty's: a TUI suspended with Ctrl+Z loses its
    /// pushed mode when the prompt redraws, and `fg` resumes it un-enhanced
    /// until it renegotiates.
    pub fn clear_leaked(&mut self) {
        self.normal.clear();
        self.normal.push(0);
        self.alternate.clear();
        self.alternate.push(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISAMBIGUATE: u16 = 1;

    #[test]
    fn is_off_until_a_program_asks_for_it() {
        assert_eq!(KittyKeyboard::default().flags(), 0);
    }

    #[test]
    fn pushes_and_pops_restore_the_parent_mode() {
        let mut k = KittyKeyboard::default();
        k.push(DISAMBIGUATE);
        assert_eq!(k.flags(), 1);

        // A nested program pushes its own richer mode...
        k.push(9);
        assert_eq!(k.flags(), 9);

        // ...and popping restores what the parent had.
        k.pop(1);
        assert_eq!(k.flags(), 1);
    }

    #[test]
    fn sets_adds_and_clears_bits_in_place() {
        let mut k = KittyKeyboard::default();
        k.set(1, 1); // set
        assert_eq!(k.flags(), 1);
        k.set(8, 2); // or
        assert_eq!(k.flags(), 9);
        k.set(1, 3); // not
        assert_eq!(k.flags(), 8);
    }

    /// A garbled sequence must not silently change how every key is encoded.
    #[test]
    fn ignores_malformed_requests_rather_than_guessing() {
        let mut k = KittyKeyboard::default();
        k.push(DISAMBIGUATE);
        k.set(2, 99); // mode outside 1..3
        assert_eq!(k.flags(), 1);
        k.set(999, 1); // flags wider than five bits
        assert_eq!(k.flags(), 1);
    }

    #[test]
    fn masks_unknown_flag_bits_instead_of_dropping_the_push() {
        let mut k = KittyKeyboard::default();
        k.push(DISAMBIGUATE);
        k.push(999); // wider than five bits
        assert_eq!(u16::from(k.flags()), 999 & FLAGS_MAX);
        // The pop still finds the level it pushed, so the shell keeps its mode.
        k.pop(1);
        assert_eq!(k.flags(), 1);
    }

    #[test]
    fn unwinds_completely_when_a_program_pops_past_the_bottom() {
        let mut k = KittyKeyboard::default();
        k.push(DISAMBIGUATE);
        k.pop(64);
        assert_eq!(k.flags(), 0);
    }

    #[test]
    fn a_leaked_push_cannot_grow_the_stack_without_bound() {
        let mut k = KittyKeyboard::default();
        for _ in 0..100 {
            k.push(DISAMBIGUATE);
        }
        assert_eq!(k.stack().len(), STACK_DEPTH);
    }

    /// The bug the per-screen stacks exist to prevent: a TUI enables the
    /// protocol on the alternate screen and is killed before it can pop. With
    /// one shared stack the shell inherits the mode and every keystroke encodes
    /// for a reader that is gone — Ctrl+C arrives as `CSI 99;5u`, so the
    /// terminal cannot even be told `reset`.
    #[test]
    fn an_alt_screen_mode_does_not_follow_the_shell_home() {
        let mut k = KittyKeyboard::default();
        k.set_screen(Screen::Alternate);
        k.push(DISAMBIGUATE);
        assert_eq!(k.flags(), 1);

        // The TUI dies. Nothing pops; the shell simply gets its screen back.
        k.set_screen(Screen::Normal);
        assert_eq!(k.flags(), 0);
    }

    #[test]
    fn keeps_a_programs_mode_while_it_visits_the_main_screen() {
        let mut k = KittyKeyboard::default();
        k.set_screen(Screen::Alternate);
        k.push(9);
        // Dropping out to run a child process and coming back is a normal thing
        // for a full-screen program to do.
        k.set_screen(Screen::Normal);
        k.set_screen(Screen::Alternate);
        assert_eq!(k.flags(), 9);
    }

    #[test]
    fn keeps_the_shells_own_mode_across_a_programs_visit() {
        let mut k = KittyKeyboard::default();
        // A shell that negotiated the protocol for its own line editor.
        k.push(DISAMBIGUATE);
        k.set_screen(Screen::Alternate);
        k.push(9);
        k.set_screen(Screen::Normal);
        assert_eq!(k.flags(), 1);
    }

    #[test]
    fn reset_clears_both_screens() {
        let mut k = KittyKeyboard::default();
        k.push(DISAMBIGUATE);
        k.set_screen(Screen::Alternate);
        k.push(9);

        k.reset();

        // A reset returns to the main screen, and finds nothing set there...
        assert_eq!(k.flags(), 0);
        // ...nor waiting on the screen it just left.
        k.set_screen(Screen::Alternate);
        assert_eq!(k.flags(), 0);
    }

    #[test]
    fn clear_leaked_zeroes_both_screens_but_keeps_the_active_one() {
        let mut k = KittyKeyboard::default();
        k.set_screen(Screen::Alternate);
        k.push(25);

        k.clear_leaked();

        assert_eq!(k.flags(), 0);
        k.set_screen(Screen::Normal);
        assert_eq!(k.flags(), 0);
    }
}
