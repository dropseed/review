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
//! ## Title activity (agent phase)
//!
//! Neither of those says anything useful while a long-lived TUI holds the
//! terminal: OSC 133 marks stop at the `C` that launched it, so a session
//! running Claude Code or Codex would read `Working` from launch to exit, right
//! through every pause where it is in fact waiting on the user.
//!
//! Both agents already broadcast the answer in the OSC 0 title, animating a
//! spinner frame into it while they work and dropping it when they hand control
//! back (`◑ Fix the parser` → `Fix the parser` for Claude Code, `⠼ review` →
//! `spur` for Codex). The first spinner frame promotes the title to
//! `agent_phase`, an authority that outranks both `base_phase` sources; any
//! OSC 133 mark demotes it again, because only the shell emits those, so one
//! arriving means the agent has exited.
//!
//! A session whose foreground command is a known agent claims that authority
//! from its *first* title, spinner or not. Otherwise the freshly launched agent
//! that has not been asked anything yet — the one titled plainly, at its prompt,
//! waiting — would read `Working` off the OSC 133 `C` that started it until the
//! first task made it spin.
//!
//! The leading marker is stripped from the surfaced `title`, so the label stays
//! put at the task summary instead of flickering through spinner frames — which
//! also keeps a working agent from publishing a status frame per animation tick.
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
    /// Phase claimed by an agent's title spinner, once one has been seen.
    /// `Some` outranks `base_phase`; an OSC 133 mark clears it.
    agent_phase: Option<Phase>,
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
            agent_phase: None,
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

    fn set_agent_phase(&mut self, phase: Option<Phase>) {
        if self.agent_phase != phase {
            self.agent_phase = phase;
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

    /// Apply an OSC 0/2 title: fold its activity marker into `agent_phase` and
    /// surface the title with that marker stripped.
    fn set_title(&mut self, value: Option<&&[u8]>) {
        let Some(bytes) = value else { return };
        let raw = String::from_utf8_lossy(bytes);
        let (working, label) = split_activity(raw.trim());
        self.note_title_activity(working);
        if self.title.as_deref() != Some(label) {
            self.title = Some(label.to_owned());
            self.dirty = true;
        }
    }

    /// Fold in what a title says about an agent's activity. The first spinner
    /// frame — or the first title at all, while a known agent is what's
    /// running — makes the title the phase authority for this session; from
    /// then on a title without a spinner means the agent handed control back to
    /// the user.
    ///
    /// A title that never carries a spinner, from a command we don't recognize
    /// as an agent, never claims the authority — so a shell that retitles itself
    /// per command (`cargo build`) is left alone.
    fn note_title_activity(&mut self, working: bool) {
        if working {
            self.set_agent_phase(Some(Phase::Working));
        } else if self.agent_phase.is_some() || self.running_agent() {
            self.set_agent_phase(Some(Phase::WaitingForInput));
        }
    }

    /// Whether the foreground command is an agent whose title is its own status
    /// display, rather than a program the shell happens to be running.
    fn running_agent(&self) -> bool {
        self.running_command
            .as_deref()
            .is_some_and(is_agent_command)
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
        // Only the shell emits 133 marks, so seeing one means any agent that had
        // claimed the phase is gone and the shell's own state is authoritative.
        self.set_agent_phase(None);
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
    /// message. ConEmu overloads the same code for machine chatter that is not
    /// a notification: `9;4;<state>;<progress>` progress reports (including
    /// the bare `9;4` reset) and `9;9;<cwd>` working-directory reports, which
    /// oh-my-posh emits on every prompt redraw.
    fn osc_9(&mut self, params: &[&[u8]]) {
        if matches!(params.get(1), Some(&b"4") | Some(&b"9")) {
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
            self.agent_phase.unwrap_or(self.base_phase)
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

/// Claude Code's ready marker — the glyph older versions carried in place of a
/// spinner frame while waiting on the user. Current ones simply drop the marker.
const READY_MARKER: char = '✳';

/// Split a title into whether it leads with a spinner frame, and the title with
/// that leading activity marker removed.
///
/// A spinner frame is any glyph from the Braille Patterns block (Codex, and
/// Claude Code up to 2.0) or the four quartered circles `◐◑◒◓` (Claude Code
/// since) — what these agents animate, and what no static title starts with.
/// The marker is stripped so the surfaced label is the part that means something
/// — and so it stops changing ten times a second while an agent works.
fn split_activity(title: &str) -> (bool, &str) {
    let mut chars = title.chars();
    match chars.next() {
        Some('\u{2800}'..='\u{28FF}' | '\u{25D0}'..='\u{25D3}') => {
            (true, chars.as_str().trim_start())
        }
        Some(READY_MARKER) => (false, chars.as_str().trim_start()),
        _ => (false, title),
    }
}

/// Commands that drive their own OSC 0 title as a status display, so a title
/// from one is a statement about the *agent's* phase rather than about a
/// program the shell is running.
const AGENT_COMMANDS: [&str; 2] = ["claude", "codex"];

/// Whether a poller-reported foreground command is one of those.
///
/// Every token is checked, not just the first, because an agent is so often
/// reached through something else: `npx claude`, `env FOO=1 codex`,
/// `pnpm dlx claude`. Matching only the program name left every one of those on
/// the bug this exists to fix. Each token is reduced to its own basename, so
/// `/opt/homebrew/bin/claude --resume` counts too.
fn is_agent_command(command: &str) -> bool {
    command.split_whitespace().any(|token| {
        let name = token.rsplit('/').next().unwrap_or(token);
        AGENT_COMMANDS.contains(&name)
    })
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
        // progress bar update, not something the user must look at — and the
        // bare `9;4` reset form must not slip through as a notification
        // bodied "4".
        assert!(feed(&mut s, b"\x1b]9;4;1;50\x07").is_none());
        assert!(feed(&mut s, b"\x1b]9;4\x07").is_none());
        assert_eq!(s.build_status().phase, Phase::Working);
    }

    #[test]
    fn osc9_cwd_report_is_not_a_notification() {
        let mut s = scanner();
        // ConEmu-style OSC 9;9;<cwd> — oh-my-posh emits this on every prompt
        // redraw, so treating it as attention would badge every prompt.
        assert!(feed(&mut s, b"\x1b]9;9;/Users/dave/repo\x07").is_none());
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
    fn title_spinner_outranks_the_command_running_mark() {
        let mut s = scanner();
        // Launching the agent is the last 133 mark until it exits, so without
        // the title tier this session reads Working for its whole life.
        feed(&mut s, b"\x1b]133;C\x07");

        let working =
            feed(&mut s, "\x1b]0;⠂ Fix the parser\x07".as_bytes()).expect("spinner changed status");
        assert_eq!(working.phase, Phase::Working);
        assert_eq!(working.title.as_deref(), Some("Fix the parser"));

        let waiting = feed(&mut s, "\x1b]0;✳ Fix the parser\x07".as_bytes())
            .expect("ready marker changed status");
        assert_eq!(waiting.phase, Phase::WaitingForInput);
        // Both markers strip to the same label, so it never flickered.
        assert_eq!(waiting.title.as_deref(), Some("Fix the parser"));
    }

    #[test]
    fn claude_codes_quartered_circle_spinner_is_a_spinner() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]133;C\x07");

        // Claude Code animates ◐◑◒◓ rather than braille as of 2.1; read as a
        // static title, every one of these sessions was Working until it exited.
        let working =
            feed(&mut s, "\x1b]0;◑ Fix the parser\x07".as_bytes()).expect("spinner changed status");
        assert_eq!(working.phase, Phase::Working);
        assert_eq!(working.title.as_deref(), Some("Fix the parser"));

        // Later frames strip to the same label, so the working agent doesn't
        // push a status frame per animation tick.
        assert!(!s.feed("\x1b]0;◒ Fix the parser\x07".as_bytes()));

        // Handing control back drops the marker entirely — there is no ready
        // glyph any more.
        let waiting =
            feed(&mut s, b"\x1b]0;Fix the parser\x07").expect("bare title changed status");
        assert_eq!(waiting.phase, Phase::WaitingForInput);
        assert_eq!(waiting.title.as_deref(), Some("Fix the parser"));
    }

    #[test]
    fn a_running_agents_first_title_claims_the_phase_without_a_spinner() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]133;C\x07");
        s.on_poll(false, Some("claude".to_owned()));

        // A freshly launched agent sitting at its own prompt titles itself
        // plainly and has never spun. The 133 `C` that started it is the last
        // mark the shell will emit, so without this it reads Working while it
        // waits.
        let waiting = feed(&mut s, b"\x1b]0;Claude Code\x07").expect("title changed status");
        assert_eq!(waiting.phase, Phase::WaitingForInput);
    }

    #[test]
    fn a_path_qualified_agent_with_arguments_is_still_an_agent() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]133;C\x07");
        s.on_poll(false, Some("/opt/homebrew/bin/claude --resume".to_owned()));

        let waiting = feed(&mut s, b"\x1b]0;Claude Code\x07").expect("title changed status");
        assert_eq!(waiting.phase, Phase::WaitingForInput);
    }

    /// An agent is usually reached through something else, and a launcher in
    /// front of it must not put the session back on the bug this fixes.
    #[test]
    fn an_agent_behind_a_launcher_is_still_an_agent() {
        for command in ["npx claude", "env FOO=1 codex", "pnpm dlx claude --resume"] {
            let mut s = scanner();
            feed(&mut s, b"\x1b]133;C\x07");
            s.on_poll(false, Some((*command).to_owned()));

            let waiting = feed(&mut s, b"\x1b]0;Claude Code\x07")
                .unwrap_or_else(|| panic!("{command} should claim the title authority"));
            assert_eq!(waiting.phase, Phase::WaitingForInput, "{command}");
        }
    }

    #[test]
    fn an_ordinary_command_titling_itself_is_not_an_agent() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]133;C\x07");
        s.on_poll(false, Some("cargo build".to_owned()));

        let titled = feed(&mut s, b"\x1b]0;cargo build\x07").expect("title changed status");
        assert_eq!(titled.phase, Phase::Working);
    }

    #[test]
    fn codex_style_bare_title_ends_the_working_state() {
        let mut s = scanner();
        // Codex spins over the plain directory name and drops back to it.
        let working =
            feed(&mut s, "\x1b]0;⠼ review\x07".as_bytes()).expect("spinner changed status");
        assert_eq!(working.phase, Phase::Working);
        assert_eq!(working.title.as_deref(), Some("review"));

        let waiting = feed(&mut s, b"\x1b]0;review\x07").expect("bare title changed status");
        assert_eq!(waiting.phase, Phase::WaitingForInput);
    }

    #[test]
    fn spinner_frames_do_not_republish() {
        let mut s = scanner();
        feed(&mut s, "\x1b]0;⠂ Fix the parser\x07".as_bytes());
        // Every later frame strips to the same label and the same phase, so a
        // working agent must not push a status frame per animation tick.
        assert!(!s.feed("\x1b]0;⠐ Fix the parser\x07".as_bytes()));
        assert!(!s.feed("\x1b]0;⠠ Fix the parser\x07".as_bytes()));
    }

    #[test]
    fn a_title_without_a_spinner_never_claims_the_phase() {
        let mut s = scanner();
        feed(&mut s, b"\x1b]133;C\x07");
        // A shell that retitles itself per command must not be read as an agent
        // going idle while its command is still running.
        let titled = feed(&mut s, b"\x1b]0;cargo build\x07").expect("title changed status");
        assert_eq!(titled.phase, Phase::Working);
        assert_eq!(titled.title.as_deref(), Some("cargo build"));
    }

    #[test]
    fn a_shell_mark_releases_the_agent_phase() {
        let mut s = scanner();
        feed(&mut s, "\x1b]0;⠂ Fix the parser\x07".as_bytes());
        assert_eq!(s.build_status().phase, Phase::Working);

        // The agent exited and the shell came back: its marks win again.
        let done = feed(&mut s, b"\x1b]133;D;0\x07").expect("D changed status");
        assert_eq!(done.phase, Phase::Idle);

        // And a spinner-less title must not reclaim the authority on its own.
        let retitled = feed(&mut s, b"\x1b]0;review\x07").expect("title changed status");
        assert_eq!(retitled.phase, Phase::Idle);
    }

    #[test]
    fn agent_waiting_still_yields_to_the_bell_overlay() {
        let mut s = scanner();
        feed(&mut s, "\x1b]0;⠂ Fix the parser\x07".as_bytes());
        // Claude Code notifies and then goes quiet; the notification outranks
        // the plain waiting state so the pane is badged, not just idle.
        feed(&mut s, b"\x1b]777;notify;Claude;Waiting for input\x07");
        feed(&mut s, "\x1b]0;✳ Fix the parser\x07".as_bytes());
        let status = s.build_status();
        assert_eq!(status.phase, Phase::NeedsAttention);

        // Answering it reveals the agent's own waiting state, not the shell's.
        assert!(s.on_write());
        assert_eq!(s.build_status().phase, Phase::WaitingForInput);
    }

    #[test]
    fn poll_does_not_override_a_working_agent() {
        let mut s = scanner();
        feed(&mut s, "\x1b]0;⠂ Fix the parser\x07".as_bytes());
        // No shell integration, so the poller owns `base_phase` — but the agent
        // is the foreground process, and the title is the better witness.
        s.on_poll(false, Some("claude".to_owned()));
        let status = s.build_status();
        assert_eq!(status.phase, Phase::Working);
        assert_eq!(status.running_command.as_deref(), Some("claude"));

        feed(&mut s, "\x1b]0;✳ Fix the parser\x07".as_bytes());
        s.on_poll(false, Some("claude".to_owned()));
        assert_eq!(s.build_status().phase, Phase::WaitingForInput);
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
