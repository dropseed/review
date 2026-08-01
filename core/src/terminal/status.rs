//! Per-session status engine: a `vte` OSC/control scanner plus the phase state
//! machine that drives the sidebar's Working / Waiting / Needs-attention / Idle
//! display.
//!
//! The scanner is fed every raw PTY chunk on the session's reader thread (see
//! [`super::session`]). It is the **primary** status path — OSC 133 shell
//! integration marks, the bell, the title, and OSC 7 working directory. A single
//! [`vte::Parser`] persists for the life of the session, so escape sequences
//! split across read boundaries reassemble correctly.
//!
//! When OSC 133 marks are absent (no shell integration), the foreground-process
//! [`poller`](super::poll) becomes the sole phase authority via
//! [`StatusScanner::on_poll`]; it always supplies `running_command` regardless.
//!
//! ## Bell overlay
//!
//! The bell sets a `needs_attention` overlay *on top of* the OSC/poll-driven
//! `base_phase`. The surfaced phase is `NeedsAttention` while the overlay is up,
//! otherwise `base_phase`. The overlay is cleared by a user write, an OSC 133
//! prompt start (`A`), or command start (`C`) — not by the command-finished
//! mark (`D`).
//!
//! Desktop-notification escapes raise the same overlay and additionally carry
//! text, surfaced as `attention_message`: OSC 777 `notify` (Claude Code) and
//! OSC 9 (Codex). The latest notification wins; a bare bell raises the overlay
//! without disturbing the message, because Claude Code's `iterm2_with_bell`
//! channel sends OSC 777 and then a BEL.
//!
//! Content peek is not part of status: it is pulled on demand through the
//! session's VT thread (see [`super::Session::peek`]), never pushed into a
//! status frame.

use vte::{Parser, Perform};

use super::{now_millis, Phase, SessionStatus, TerminalId};

/// The mutable status state plus the `vte::Perform` sink. The [`Perform`] impl
/// mutates these fields in place and raises `dirty` whenever a surfaced field
/// changes; [`Sink::build_status`] then finalizes the effective phase.
struct Sink {
    id: TerminalId,
    /// The effective phase last surfaced (bell overlay applied).
    phase: Phase,
    /// Phase driven by OSC 133 / the poller, without the bell overlay.
    base_phase: Phase,
    /// Bell overlay: something rang the bell and wants the user's attention.
    needs_attention: bool,
    /// Text of the notification that raised the overlay, if it carried any.
    attention_message: Option<String>,
    running_command: Option<String>,
    last_exit_code: Option<i32>,
    cwd: Option<String>,
    title: Option<String>,
    entered_state_at: u64,
    shell_integration_active: bool,
    /// Raised whenever a surfaced field changed since the last emit.
    dirty: bool,
}

impl Sink {
    fn new(id: TerminalId, cwd: Option<String>) -> Self {
        Self {
            id,
            phase: Phase::Working,
            base_phase: Phase::Working,
            needs_attention: false,
            attention_message: None,
            running_command: None,
            last_exit_code: None,
            cwd,
            title: None,
            entered_state_at: now_millis(),
            shell_integration_active: false,
            dirty: false,
        }
    }

    /// Snapshot the current fields as a wire status (no effective-phase recompute).
    fn to_status(&self) -> SessionStatus {
        SessionStatus {
            id: self.id.clone(),
            phase: self.phase,
            attention_message: self.attention_message.clone(),
            running_command: self.running_command.clone(),
            last_exit_code: self.last_exit_code,
            cwd: self.cwd.clone(),
            title: self.title.clone(),
            entered_state_at: self.entered_state_at,
            shell_integration_active: self.shell_integration_active,
        }
    }

    fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }

    fn activate_integration(&mut self) {
        if !self.shell_integration_active {
            self.shell_integration_active = true;
            self.dirty = true;
        }
    }

    fn set_base_phase(&mut self, phase: Phase) {
        if self.base_phase != phase {
            self.base_phase = phase;
            self.dirty = true;
        }
    }

    fn set_last_exit(&mut self, code: Option<i32>) {
        if self.last_exit_code != code {
            self.last_exit_code = code;
            self.dirty = true;
        }
    }

    fn clear_attention(&mut self) {
        if self.needs_attention || self.attention_message.is_some() {
            self.needs_attention = false;
            self.attention_message = None;
            self.dirty = true;
        }
    }

    /// Raise the overlay, optionally with notification text. `None` (a bare
    /// bell) keeps any message already there — Claude Code's `iterm2_with_bell`
    /// channel emits OSC 777 and then a BEL, and the bell must not erase it.
    fn raise_attention(&mut self, message: Option<String>) {
        if !self.needs_attention {
            self.needs_attention = true;
            self.dirty = true;
        }
        if let Some(text) = message {
            if self.attention_message.as_deref() != Some(text.as_str()) {
                self.attention_message = Some(text);
                self.dirty = true;
            }
        }
    }

    fn set_title(&mut self, value: Option<&&[u8]>) {
        if let Some(bytes) = value {
            let title = String::from_utf8_lossy(bytes).into_owned();
            if self.title.as_deref() != Some(title.as_str()) {
                self.title = Some(title);
                self.dirty = true;
            }
        }
    }

    fn set_cwd_osc7(&mut self, value: Option<&&[u8]>) {
        if let Some(bytes) = value {
            if let Some(path) = parse_osc7(&String::from_utf8_lossy(bytes)) {
                if self.cwd.as_deref() != Some(path.as_str()) {
                    self.cwd = Some(path);
                    self.dirty = true;
                }
            }
        }
    }

    /// Apply an OSC 133 shell-integration mark.
    fn osc_133(&mut self, params: &[&[u8]]) {
        self.activate_integration();
        let Some(sub) = params.get(1) else { return };
        match sub.first() {
            // Prompt start: at a prompt, waiting for input; clear the bell.
            Some(&b'A') => {
                self.clear_attention();
                self.set_base_phase(Phase::WaitingForInput);
            }
            // Prompt end: still waiting for input.
            Some(&b'B') => {
                self.set_base_phase(Phase::WaitingForInput);
            }
            // Command start: a command is running; reset exit code; clear the bell.
            Some(&b'C') => {
                self.clear_attention();
                self.set_last_exit(None);
                self.set_base_phase(Phase::Working);
            }
            // Command end: record the exit code and go idle.
            Some(&b'D') => {
                if let Some(code) = params.get(2) {
                    if let Ok(text) = std::str::from_utf8(code) {
                        if let Ok(n) = text.trim().parse::<i32>() {
                            self.set_last_exit(Some(n));
                        }
                    }
                }
                self.set_base_phase(Phase::Idle);
            }
            _ => {}
        }
    }

    /// Apply an OSC 9 desktop notification (Codex): the whole remainder is the
    /// message. ConEmu's progress report `OSC 9;4;<state>;<progress>` shares the
    /// code and is not a notification.
    fn osc_9(&mut self, params: &[&[u8]]) {
        if params.len() >= 3 && matches!(params.get(1), Some(&b"4")) {
            return;
        }
        self.raise_attention(non_empty(join_params(&params[1..])));
    }

    /// Apply an OSC 777 `notify;<title>;<body>` desktop notification (Claude
    /// Code). Other 777 subcommands are not notifications.
    fn osc_777(&mut self, params: &[&[u8]]) {
        if !matches!(params.get(1), Some(&b"notify")) {
            return;
        }
        let title = params
            .get(2)
            .map_or_else(String::new, |b| String::from_utf8_lossy(b).into_owned());
        let body = join_params(params.get(3..).unwrap_or(&[]));
        let message = [title, body]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(": ");
        self.raise_attention(non_empty(message));
    }

    /// Fold in a poller observation: `running_command` always, and — only when
    /// shell integration is inactive — the phase derived from whether the shell
    /// itself is the foreground process group.
    fn apply_poll(&mut self, at_prompt: bool, command: Option<String>) {
        if self.running_command != command {
            self.running_command = command;
            self.dirty = true;
        }
        if !self.shell_integration_active {
            let want = if at_prompt {
                Phase::WaitingForInput
            } else {
                Phase::Working
            };
            self.set_base_phase(want);
        }
    }

    /// Recompute the effective phase (base + bell overlay), refresh
    /// `entered_state_at` on a real phase change, and return the resulting
    /// status. Call only when something changed.
    fn build_status(&mut self) -> SessionStatus {
        let effective = if self.needs_attention {
            Phase::NeedsAttention
        } else {
            self.base_phase
        };
        if effective != self.phase {
            self.entered_state_at = now_millis();
            self.phase = effective;
        }
        self.to_status()
    }
}

impl Perform for Sink {
    fn execute(&mut self, byte: u8) {
        // A standalone BEL (0x07). OSC sequences terminated by BEL are consumed
        // by the parser as the terminator and never reach `execute`.
        if byte == 0x07 {
            self.raise_attention(None);
        }
    }

    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        let Some(kind) = params.first() else { return };
        match *kind {
            b"133" => self.osc_133(params),
            b"9" => self.osc_9(params),
            b"777" => self.osc_777(params),
            b"0" | b"2" => self.set_title(params.get(1)),
            b"7" => self.set_cwd_osc7(params.get(1)),
            _ => {}
        }
    }
}

/// Rejoin OSC parameters with their `;` separators. `vte` splits on `;`, so a
/// notification message that contained one arrives as several parameters.
fn join_params(params: &[&[u8]]) -> String {
    params
        .iter()
        .map(|p| String::from_utf8_lossy(p))
        .collect::<Vec<_>>()
        .join(";")
}

/// A notification with no text raises the overlay but carries no message.
fn non_empty(text: String) -> Option<String> {
    (!text.is_empty()).then_some(text)
}

/// Parse an OSC 7 `file://<host><path>` value into its (percent-decoded) path.
fn parse_osc7(value: &str) -> Option<String> {
    let rest = value.strip_prefix("file://")?;
    // The path is everything from the first slash after the host component.
    let slash = rest.find('/')?;
    let path = &rest[slash..];
    Some(urlencoding::decode(path).map_or_else(|_| path.to_owned(), std::borrow::Cow::into_owned))
}

/// The status engine for one session: a persistent `vte::Parser` feeding a
/// [`Sink`] state machine.
///
/// Lives behind a mutex on the session and is driven from three places: the
/// reader thread ([`feed`](Self::feed)), user writes
/// ([`on_write`](Self::on_write)), and the foreground poller
/// ([`on_poll`](Self::on_poll)). Each returns `true` when the surfaced status
/// changed and the session should publish; the session then calls
/// [`build_status`](Self::build_status) to produce the wire value.
pub struct StatusScanner {
    parser: Parser,
    sink: Sink,
}

impl StatusScanner {
    /// Create a scanner seeded with the session's initial working directory.
    pub fn new(id: TerminalId, cwd: Option<String>) -> Self {
        Self {
            parser: Parser::new(),
            sink: Sink::new(id, cwd),
        }
    }

    /// Feed a raw PTY chunk. Returns whether the surfaced status changed.
    pub fn feed(&mut self, chunk: &[u8]) -> bool {
        for &byte in chunk {
            self.parser.advance(&mut self.sink, byte);
        }
        self.sink.take_dirty()
    }

    /// Note a user write to the terminal: clears the bell overlay. Returns
    /// whether the surfaced status changed.
    pub fn on_write(&mut self) -> bool {
        self.sink.clear_attention();
        self.sink.take_dirty()
    }

    /// Fold in a poller observation. `at_prompt` is whether the shell itself is
    /// the foreground process group. Returns whether the surfaced status changed.
    pub fn on_poll(&mut self, at_prompt: bool, command: Option<String>) -> bool {
        self.sink.apply_poll(at_prompt, command);
        self.sink.take_dirty()
    }

    /// Finalize the effective phase and produce the wire status.
    pub fn build_status(&mut self) -> SessionStatus {
        self.sink.build_status()
    }

    /// The current status without recomputing the effective phase (used to seed
    /// the session's published status at spawn).
    pub fn current_status(&self) -> SessionStatus {
        self.sink.to_status()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scanner() -> StatusScanner {
        StatusScanner::new(TerminalId::from("test"), Some("/start".to_owned()))
    }

    /// Feed bytes and, if the status changed, return the freshly built status.
    fn feed(scanner: &mut StatusScanner, bytes: &[u8]) -> Option<SessionStatus> {
        scanner.feed(bytes).then(|| scanner.build_status())
    }

    #[test]
    fn osc133_sequence_drives_working_idle_with_exit_code() {
        let mut s = scanner();

        let a = feed(&mut s, b"\x1b]133;A\x07").expect("A changed status");
        assert_eq!(a.phase, Phase::WaitingForInput);
        assert!(a.shell_integration_active);

        let c = feed(&mut s, b"\x1b]133;C\x07").expect("C changed status");
        assert_eq!(c.phase, Phase::Working);
        assert_eq!(c.last_exit_code, None);

        let d = feed(&mut s, b"\x1b]133;D;0\x07").expect("D changed status");
        assert_eq!(d.phase, Phase::Idle);
        assert_eq!(d.last_exit_code, Some(0));
    }

    #[test]
    fn osc133_records_command_failure() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]133;C\x07");
        let d = feed(&mut s, b"\x1b]133;D;1\x07").expect("D changed status");
        assert_eq!(d.phase, Phase::Idle);
        assert_eq!(d.last_exit_code, Some(1));
    }

    #[test]
    fn bell_sets_needs_attention_and_write_clears_it() {
        let mut s = scanner();
        // Establish a base phase first.
        feed(&mut s, b"\x1b]133;C\x07");

        let bell = feed(&mut s, b"\x07").expect("bell changed status");
        assert_eq!(bell.phase, Phase::NeedsAttention);

        // A user write clears the overlay, revealing the base (Working) phase.
        assert!(s.on_write());
        let cleared = s.build_status();
        assert_eq!(cleared.phase, Phase::Working);
    }

    #[test]
    fn prompt_start_clears_needs_attention() {
        let mut s = scanner();
        feed(&mut s, b"\x07");
        let a = feed(&mut s, b"\x1b]133;A\x07").expect("A changed status");
        // A both clears the bell and moves to WaitingForInput.
        assert_eq!(a.phase, Phase::WaitingForInput);
    }

    #[test]
    fn plain_bell_carries_no_message() {
        let mut s = scanner();
        let bell = feed(&mut s, b"\x07").expect("bell changed status");
        assert_eq!(bell.phase, Phase::NeedsAttention);
        assert_eq!(bell.attention_message, None);
    }

    #[test]
    fn osc9_notification_sets_attention_message() {
        let mut s = scanner();
        let n = feed(&mut s, b"\x1b]9;Codex is waiting\x07").expect("OSC 9 changed status");
        assert_eq!(n.phase, Phase::NeedsAttention);
        assert_eq!(n.attention_message.as_deref(), Some("Codex is waiting"));
    }

    #[test]
    fn osc9_message_keeps_its_semicolons() {
        let mut s = scanner();
        // vte splits parameters on ';'; the message must be rejoined.
        let n = feed(&mut s, b"\x1b]9;done: a; b; c\x07").expect("OSC 9 changed status");
        assert_eq!(n.attention_message.as_deref(), Some("done: a; b; c"));
    }

    #[test]
    fn osc9_progress_report_is_not_a_notification() {
        let mut s = scanner();
        // ConEmu-style OSC 9;4;<state>;<progress> shares the code but is a
        // progress bar update, not something the user must look at.
        assert!(feed(&mut s, b"\x1b]9;4;1;50\x07").is_none());
        assert_eq!(s.build_status().phase, Phase::Working);
    }

    #[test]
    fn osc777_notify_composes_title_and_body() {
        let mut s = scanner();
        let n = feed(&mut s, b"\x1b]777;notify;Claude Code;Waiting for input\x07")
            .expect("OSC 777 changed status");
        assert_eq!(n.phase, Phase::NeedsAttention);
        assert_eq!(
            n.attention_message.as_deref(),
            Some("Claude Code: Waiting for input")
        );
    }

    #[test]
    fn osc777_body_keeps_its_semicolons() {
        let mut s = scanner();
        let n =
            feed(&mut s, b"\x1b]777;notify;Claude;ran: a; b\x07").expect("OSC 777 changed status");
        assert_eq!(n.attention_message.as_deref(), Some("Claude: ran: a; b"));
    }

    #[test]
    fn bell_after_notification_keeps_the_message() {
        let mut s = scanner();
        // Claude Code's "iterm2_with_bell" channel sends OSC 777 then a BEL.
        feed(&mut s, b"\x1b]777;notify;Claude;Waiting\x07");
        s.feed(b"\x07");
        let after = s.build_status();
        assert_eq!(after.phase, Phase::NeedsAttention);
        assert_eq!(after.attention_message.as_deref(), Some("Claude: Waiting"));
    }

    #[test]
    fn write_clears_the_message_with_the_overlay() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]9;Waiting\x07");
        assert!(s.on_write());
        let cleared = s.build_status();
        assert_ne!(cleared.phase, Phase::NeedsAttention);
        assert_eq!(cleared.attention_message, None);
    }

    #[test]
    fn prompt_start_clears_the_message() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]9;Waiting\x07");
        let a = feed(&mut s, b"\x1b]133;A\x07").expect("A changed status");
        assert_eq!(a.phase, Phase::WaitingForInput);
        assert_eq!(a.attention_message, None);
    }

    #[test]
    fn sequence_split_across_chunks_parses() {
        let mut s = scanner();
        // Split the OSC 133 D mark at an arbitrary byte boundary.
        assert!(feed(&mut s, b"\x1b]133;D").is_none());
        let d = feed(&mut s, b";0\x07").expect("reassembled D changed status");
        assert_eq!(d.phase, Phase::Idle);
        assert_eq!(d.last_exit_code, Some(0));
    }

    #[test]
    fn osc7_sets_cwd_percent_decoded() {
        let mut s = scanner();
        let status =
            feed(&mut s, b"\x1b]7;file://host/tmp/my%20dir\x07").expect("OSC 7 changed status");
        assert_eq!(status.cwd.as_deref(), Some("/tmp/my dir"));
    }

    #[test]
    fn osc0_sets_title() {
        let mut s = scanner();
        let status = feed(&mut s, b"\x1b]0;My Title\x07").expect("OSC 0 changed status");
        assert_eq!(status.title.as_deref(), Some("My Title"));
    }

    #[test]
    fn entered_state_at_changes_only_on_phase_change() {
        let mut s = scanner();
        let a = feed(&mut s, b"\x1b]133;A\x07").expect("A changed status");
        let t_waiting = a.entered_state_at;

        // A second prompt-end mark keeps us WaitingForInput — no phase change,
        // so the timestamp must not move.
        std::thread::sleep(std::time::Duration::from_millis(2));
        // B is a no-op transition; force a rebuild and confirm the stamp holds.
        s.feed(b"\x1b]133;B\x07");
        let held = s.build_status();
        assert_eq!(held.phase, Phase::WaitingForInput);
        assert_eq!(
            held.entered_state_at, t_waiting,
            "no phase change must hold the stamp"
        );

        // A real phase change moves the stamp forward.
        std::thread::sleep(std::time::Duration::from_millis(2));
        let c = feed(&mut s, b"\x1b]133;C\x07").expect("C changed status");
        assert_eq!(c.phase, Phase::Working);
        assert!(
            c.entered_state_at > t_waiting,
            "phase change must advance the stamp"
        );
    }

    #[test]
    fn poll_drives_phase_only_without_shell_integration() {
        let mut s = scanner();

        // No integration yet: the poller is authoritative for phase.
        assert!(s.on_poll(false, Some("cargo".to_owned())));
        let working = s.build_status();
        assert_eq!(working.phase, Phase::Working);
        assert_eq!(working.running_command.as_deref(), Some("cargo"));

        // Shell integration takes over phase; the poller still sets the command.
        feed(&mut s, b"\x1b]133;A\x07");
        assert!(s.on_poll(true, Some("still-reported".to_owned())));
        let waiting = s.build_status();
        assert_eq!(waiting.phase, Phase::WaitingForInput);
        assert_eq!(waiting.running_command.as_deref(), Some("still-reported"));
    }
}
