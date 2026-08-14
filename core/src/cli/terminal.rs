//! `review terminal` — inspect and drive the app's terminal sessions.
//!
//! These commands are thin clients of the `review-daemon` control socket — the
//! same protocol the desktop app speaks — so an agent can list, start, read,
//! and write the very sessions the app shows. The daemon owns the PTYs;
//! nothing here bypasses it, and a session started here appears in the app
//! like any other.
//!
//! The agent-facing surface mirrors what terminal multiplexers expose to
//! scripts: raw input (`send`), a screen snapshot (`peek`, the libghostty-vt
//! render), and blocking waits (`wait --until <phase>` / `wait --match
//! <regex>`). The waits are built entirely client-side on the daemon's stream
//! connection — status transitions and raw output frames — so the daemon
//! needed no new ops.

use std::sync::LazyLock;
use std::time::Duration;

use clap::{Args, Subcommand, ValueEnum};
use regex::Regex;
use serde_json::json;

use crate::daemon::{socket_path, DaemonClient, Op, StreamFrame};
use crate::terminal::{Phase, SessionStatus, TerminalSummary};
use crate::work::router;

use super::common::{new_id_suffix, print_json, resolve_cwd_arg};

/// Message shown when the control socket can't be reached. The daemon is
/// spawned by the desktop app (and outlives it); the CLI only ever attaches.
const DAEMON_UNAVAILABLE: &str =
    "The terminal daemon is not running. Open the Review app to start it.";

#[derive(Debug, Args)]
pub struct TerminalArgs {
    #[command(subcommand)]
    pub action: TerminalAction,
}

#[derive(Debug, Subcommand)]
pub enum TerminalAction {
    /// List live terminal sessions
    List(ListArgs),
    /// Start a new terminal session
    Start(StartArgs),
    /// Print a plain-text snapshot of a session's visible screen
    Peek(TargetArgs),
    /// Send text and/or named keys to a session's stdin
    Send(SendArgs),
    /// Block until a session reaches a phase, prints matching output, or exits
    Wait(WaitArgs),
    /// Resize a session's PTY
    Resize(ResizeArgs),
    /// Terminate sessions
    Kill(KillArgs),
}

#[derive(Debug, Args)]
pub struct ListArgs {
    /// Repository path (defaults to the current directory's repo)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// List sessions across every repo
    #[arg(long, conflicts_with = "repo")]
    pub all: bool,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct StartArgs {
    /// Repository path (defaults to the current directory's repo)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// Working directory for the shell (defaults to the repo root)
    #[arg(long)]
    pub cwd: Option<String>,
    /// Terminal id (defaults to a generated one; pick a name agents can reuse)
    #[arg(long)]
    pub id: Option<String>,
    #[arg(long, default_value_t = 120)]
    pub cols: u16,
    #[arg(long, default_value_t = 40)]
    pub rows: u16,
    /// Shell to run (defaults to the daemon's default shell)
    #[arg(long)]
    pub shell: Option<String>,
    /// Workspace to start the session in (a unique id prefix); defaults to
    /// whatever the working directory routes to
    #[arg(long, value_name = "ID")]
    pub workspace: Option<String>,
    /// Output the session summary as JSON
    #[arg(long)]
    pub json: bool,
}

/// The `<id>` argument shared by every command that targets one session.
#[derive(Debug, Args)]
pub struct TargetArgs {
    /// Terminal id (a unique prefix is accepted; ids resolve across all repos)
    pub id: String,
}

#[derive(Debug, Args)]
pub struct SendArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    /// Text to type into the session, sent verbatim (no newline)
    pub text: Option<String>,
    /// Named keys to send after the text: enter, tab, esc, backspace, space,
    /// up/down/left/right, home, end, ctrl-<letter>
    #[arg(long = "key", value_name = "KEY")]
    pub keys: Vec<String>,
    /// Press Enter at the end (sugar for a trailing `--key enter`)
    #[arg(short, long)]
    pub enter: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum UntilArg {
    Working,
    WaitingForInput,
    NeedsAttention,
    Idle,
    /// The session's child process exits
    Exit,
}

impl UntilArg {
    /// The phase this waits for; `Exit` waits for process exit instead.
    fn phase(self) -> Option<Phase> {
        match self {
            UntilArg::Working => Some(Phase::Working),
            UntilArg::WaitingForInput => Some(Phase::WaitingForInput),
            UntilArg::NeedsAttention => Some(Phase::NeedsAttention),
            UntilArg::Idle => Some(Phase::Idle),
            UntilArg::Exit => None,
        }
    }
}

#[derive(Debug, Args)]
pub struct WaitArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    /// Phase to wait for, or `exit`
    #[arg(long, value_enum)]
    pub until: Option<UntilArg>,
    /// Wait until output produced *after this command starts* matches REGEX
    #[arg(long = "match", value_name = "REGEX")]
    pub match_output: Option<String>,
    /// Give up after this many seconds
    #[arg(long, default_value_t = 60)]
    pub timeout: u64,
    /// Output the result as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ResizeArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    #[arg(long)]
    pub cols: u16,
    #[arg(long)]
    pub rows: u16,
}

#[derive(Debug, Args)]
pub struct KillArgs {
    /// Terminal ids (unique prefixes are accepted)
    #[arg(required = true)]
    pub ids: Vec<String>,
}

/// Entry point: bridge the synchronous CLI onto the async daemon client.
pub fn run_terminal(args: TerminalArgs) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("Failed to start async runtime: {e}"))?;
    runtime.block_on(dispatch(args.action))
}

async fn dispatch(action: TerminalAction) -> Result<(), String> {
    let socket = socket_path().map_err(|e| e.to_string())?;
    let client = DaemonClient::connect(&socket)
        .await
        .map_err(|_| DAEMON_UNAVAILABLE.to_owned())?;

    match action {
        TerminalAction::List(args) => run_list(&client, args).await,
        TerminalAction::Start(args) => run_start(&client, args).await,
        TerminalAction::Peek(args) => {
            let id = resolve_id(&client, &args.id).await?;
            let screen: String = request(&client, Op::Peek { terminal_id: id }).await?;
            println!("{screen}");
            Ok(())
        }
        TerminalAction::Send(args) => run_send(&client, args).await,
        TerminalAction::Wait(args) => run_wait(&client, args).await,
        TerminalAction::Resize(args) => run_resize(&client, args).await,
        TerminalAction::Kill(args) => run_kill(&client, args).await,
    }
}

/// Run one control op and decode its Ok payload.
async fn request<T: serde::de::DeserializeOwned>(
    client: &DaemonClient,
    op: Op,
) -> Result<T, String> {
    client.request_as(op).await.map_err(|e| format!("{e:#}"))
}

/// Run an op whose Ok payload carries nothing.
async fn ack(client: &DaemonClient, op: Op) -> Result<(), String> {
    request::<serde_json::Value>(client, op).await.map(|_| ())
}

async fn list_sessions(
    client: &DaemonClient,
    repo_path: Option<String>,
) -> Result<Vec<TerminalSummary>, String> {
    request(client, Op::List { repo_path }).await
}

/// Resolve a user-supplied id against the live sessions, accepting a unique
/// prefix so agents don't have to echo full UUIDs back.
async fn resolve_id(client: &DaemonClient, query: &str) -> Result<String, String> {
    let sessions = list_sessions(client, None).await?;
    match_id(sessions.iter().map(|s| s.id.0.as_str()), query)
}

/// Exact match wins; otherwise a prefix must be unique.
fn match_id<'a>(ids: impl Iterator<Item = &'a str>, query: &str) -> Result<String, String> {
    let mut matches = Vec::new();
    for id in ids {
        if id == query {
            return Ok(id.to_owned());
        }
        if id.starts_with(query) {
            matches.push(id.to_owned());
        }
    }
    match matches.len() {
        0 => Err(format!("No terminal session matches '{query}'.")),
        1 => Ok(matches.remove(0)),
        _ => Err(format!(
            "'{query}' is ambiguous; it matches: {}",
            matches.join(", ")
        )),
    }
}

async fn run_list(client: &DaemonClient, args: ListArgs) -> Result<(), String> {
    // Outside a repo (and without --repo/--all), fall back to every session
    // rather than erroring — an agent asking "what terminals exist?" should
    // always get an answer.
    let repo_filter = if args.all {
        None
    } else if args.repo.is_some() {
        Some(super::get_repo_path(&args.repo)?)
    } else {
        super::get_repo_path(&None).ok()
    };

    let sessions = list_sessions(client, repo_filter).await?;
    if args.json {
        print_json(&sessions);
        return Ok(());
    }
    if sessions.is_empty() {
        println!("No terminal sessions.");
        return Ok(());
    }
    for s in &sessions {
        let activity = s
            .status
            .running_command
            .as_deref()
            .or(s.status.title.as_deref())
            .unwrap_or("-");
        println!("{}  {}  {}  {}", s.id, s.status.phase, activity, s.cwd);
    }
    Ok(())
}

async fn run_start(client: &DaemonClient, args: StartArgs) -> Result<(), String> {
    // One filesystem resolution feeds all three answers: which working tree the
    // session belongs to, where its shell starts, and which workspace owns it.
    let start = resolve_cwd_arg(args.cwd.clone().or_else(|| args.repo.clone()))?;
    let location = router::locate(&start);
    let repo_path = match &args.repo {
        // An explicit --repo is kept verbatim, because `terminal list --repo`
        // filters on the string the session was started with.
        Some(repo) => repo.clone(),
        None => location.working_tree.to_string_lossy().into_owned(),
    };
    // The shell starts where --cwd asked, or at the repo root.
    let cwd = match &args.cwd {
        Some(_) => start.to_string_lossy().into_owned(),
        None => repo_path.clone(),
    };
    let terminal_id = args
        .id
        .unwrap_or_else(|| format!("cli-{}", new_id_suffix()));

    // Every session belongs to a workspace from birth — the router places it,
    // and `--workspace` names one explicitly (which attaches nothing: naming
    // where a shell goes is not saying what the workspace is about).
    let landing = router::land(&location, args.workspace.as_deref()).map_err(|e| e.to_string())?;

    let summary: TerminalSummary = request(
        client,
        Op::Start {
            terminal_id,
            repo_path,
            cwd,
            cols: args.cols,
            rows: args.rows,
            shell: args.shell,
            workspace_id: Some(landing.workspace.id.clone()),
        },
    )
    .await?;

    let verb = if landing.created {
        "new workspace"
    } else {
        "joined"
    };
    if args.json {
        // The landing rides along with the session, so an agent gets one answer
        // to "what did I just start, and where did it land?".
        let mut payload = serde_json::to_value(&summary).map_err(|e| e.to_string())?;
        payload["workspace"] = json!({
            "id": landing.workspace.id,
            "title": landing.workspace.display_title(None),
            "created": landing.created,
        });
        print_json(&payload);
    } else {
        println!(
            "Started terminal {} in {} · {verb} \"{}\" ({}).",
            summary.id,
            summary.cwd,
            landing.workspace.display_title(None),
            landing.workspace.id
        );
    }
    Ok(())
}

async fn run_send(client: &DaemonClient, args: SendArgs) -> Result<(), String> {
    let mut bytes = Vec::new();
    if let Some(text) = &args.text {
        bytes.extend_from_slice(text.as_bytes());
    }
    for key in &args.keys {
        bytes.extend_from_slice(&encode_key(key)?);
    }
    if args.enter {
        bytes.push(b'\r');
    }
    if bytes.is_empty() {
        return Err("Nothing to send: pass TEXT, --key, or --enter.".to_owned());
    }

    let id = resolve_id(client, &args.target.id).await?;
    client.write(&id, &bytes).await.map_err(|e| e.to_string())?;
    println!("Sent {} byte(s) to {id}.", bytes.len());
    Ok(())
}

async fn run_resize(client: &DaemonClient, args: ResizeArgs) -> Result<(), String> {
    let id = resolve_id(client, &args.target.id).await?;
    ack(
        client,
        Op::Resize {
            terminal_id: id.clone(),
            cols: args.cols,
            rows: args.rows,
        },
    )
    .await?;
    println!("Resized {id} to {}x{}.", args.cols, args.rows);
    Ok(())
}

async fn run_kill(client: &DaemonClient, args: KillArgs) -> Result<(), String> {
    // One list snapshot resolves every target — and validates them all before
    // anything is killed.
    let sessions = list_sessions(client, None).await?;
    let ids = args
        .ids
        .iter()
        .map(|target| match_id(sessions.iter().map(|s| s.id.0.as_str()), target))
        .collect::<Result<Vec<_>, _>>()?;
    for id in ids {
        ack(
            client,
            Op::Kill {
                terminal_id: id.clone(),
            },
        )
        .await?;
        println!("Killed {id}.");
    }
    Ok(())
}

/// Translate a named key to the bytes a terminal expects for it.
///
/// Legacy encoding only: a session that has negotiated the Kitty keyboard
/// protocol expects different sequences for some of these, and the CLI does
/// not track that per-session state (today only the frontend does, in
/// `kitty-keys.ts`). Fine for shells and TUIs in their default mode; if it
/// ever bites, the deeper fix is a daemon-side send-key op encoded against
/// the session's own negotiated mode.
fn encode_key(key: &str) -> Result<Vec<u8>, String> {
    let k = key.to_ascii_lowercase();
    if let Some(letter) = k.strip_prefix("ctrl-").or_else(|| k.strip_prefix("c-")) {
        return match letter.as_bytes() {
            [b] if b.is_ascii_alphabetic() => Ok(vec![b & 0x1f]),
            _ => Err(format!("Unsupported key '{key}' (ctrl- takes one letter).")),
        };
    }
    let bytes: &[u8] = match k.as_str() {
        "enter" | "return" | "cr" => b"\r",
        "tab" => b"\t",
        "escape" | "esc" => b"\x1b",
        "backspace" => b"\x7f",
        "space" => b" ",
        "up" => b"\x1b[A",
        "down" => b"\x1b[B",
        "left" => b"\x1b[D",
        "right" => b"\x1b[C",
        "home" => b"\x1b[H",
        "end" => b"\x1b[F",
        _ => {
            return Err(format!(
                "Unknown key '{key}' (try enter, tab, esc, backspace, space, \
                 up/down/left/right, home, end, ctrl-<letter>)."
            ))
        }
    };
    Ok(bytes.to_vec())
}

/// What a `wait` resolved to.
#[derive(Debug)]
enum WaitOutcome {
    /// The session reached the requested phase.
    Phase(SessionStatus),
    /// New output matched the regex; carries the matching line, cleaned of
    /// escape sequences.
    Matched(String),
    /// The session's child exited.
    Exited(Option<i32>),
}

async fn run_wait(client: &DaemonClient, args: WaitArgs) -> Result<(), String> {
    if args.until.is_none() && args.match_output.is_none() {
        return Err("Pass --until <phase|exit> and/or --match <regex>.".to_owned());
    }
    let until_exit = args.until == Some(UntilArg::Exit);
    let until_phase = args.until.and_then(UntilArg::phase);
    let matcher = match &args.match_output {
        Some(pattern) => {
            Some(Regex::new(pattern).map_err(|e| format!("Invalid --match regex: {e}"))?)
        }
        None => None,
    };

    let id = resolve_id(client, &args.target.id).await?;
    let outcome = tokio::time::timeout(
        Duration::from_secs(args.timeout),
        wait_for(client, &id, until_phase, matcher.as_ref()),
    )
    .await
    .map_err(|_| format!("Timed out after {}s waiting on {id}.", args.timeout))??;

    let (payload, line) = match outcome {
        // An exit is a success only when it's what was asked for; otherwise
        // the condition can never be met, and a scripting agent needs the
        // failure.
        WaitOutcome::Exited(code) => {
            let code_text = code.map_or_else(|| "unknown".to_owned(), |c| c.to_string());
            if !until_exit {
                return Err(format!(
                    "Session {id} exited (code {code_text}) before the wait condition was met."
                ));
            }
            (
                json!({ "exited": true, "exitCode": code }),
                format!("Session {id} exited (code {code_text})."),
            )
        }
        WaitOutcome::Phase(status) => {
            let line = format!("Session {id} is now {}.", status.phase);
            (
                serde_json::to_value(&status).map_err(|e| e.to_string())?,
                line,
            )
        }
        WaitOutcome::Matched(text) => (json!({ "matched": text }), format!("Matched: {text}")),
    };
    if args.json {
        print_json(&payload);
    } else {
        println!("{line}");
    }
    Ok(())
}

/// Watch one session's stream until a condition holds.
///
/// Subscribes *before* checking the current phase, so a transition landing
/// between the two is seen either by the snapshot (it already happened) or by
/// a later status frame (it hadn't yet) — never missed. The snapshot is a
/// second `Op::List` after `resolve_id`'s, and deliberately so: reusing the
/// pre-subscribe list would reopen the race. Output matching is
/// new-output-only: scrollback is history the caller has already seen or can
/// `peek` at.
async fn wait_for(
    client: &DaemonClient,
    id: &str,
    until_phase: Option<Phase>,
    matcher: Option<&Regex>,
) -> Result<WaitOutcome, String> {
    let mut stream = client
        .open_stream(id)
        .await
        .map_err(|e| format!("Could not open the output stream for {id}: {e}"))?;

    // Already there? (List includes each session's current status.)
    if let Some(want) = until_phase {
        let sessions = list_sessions(client, None).await?;
        if let Some(current) = sessions.into_iter().find(|s| s.id.0 == id) {
            if current.status.phase == want {
                return Ok(WaitOutcome::Phase(current.status));
            }
        }
    }

    // Rolling window of cooked output for regex matching, bounded so a chatty
    // session can't grow it without limit. Big enough that a match spanning
    // two PTY chunks still lands inside one window.
    const MATCH_WINDOW: usize = 64 * 1024;
    let mut window = String::new();
    let mut pending_cr = false;

    while let Some(frame) = stream.recv().await {
        match frame {
            StreamFrame::Status(raw) => {
                let Ok(status) = serde_json::from_value::<SessionStatus>(raw) else {
                    continue;
                };
                if until_phase == Some(status.phase) {
                    return Ok(WaitOutcome::Phase(status));
                }
            }
            StreamFrame::Output { data, .. } => {
                let Some(regex) = matcher else { continue };
                append_cooked(
                    &mut window,
                    &mut pending_cr,
                    &String::from_utf8_lossy(&data),
                );
                if let Some(found) = regex.find(&window) {
                    let start = window[..found.end()].rfind('\n').map_or(0, |i| i + 1);
                    let line = window[start..].lines().next().unwrap_or_default();
                    return Ok(WaitOutcome::Matched(line.trim_end().to_owned()));
                }
                if window.len() > MATCH_WINDOW {
                    let mut cut = window.len() - MATCH_WINDOW / 2;
                    while !window.is_char_boundary(cut) {
                        cut += 1;
                    }
                    window.drain(..cut);
                }
            }
            StreamFrame::Exit { exit_code } => return Ok(WaitOutcome::Exited(exit_code)),
            StreamFrame::Error { message } => return Err(message),
        }
    }
    // The daemon closes a stream *after* its exit frame, so getting here
    // means the connection died, not the session.
    Err(format!("Lost the output stream for {id}."))
}

/// Escape sequences a PTY byte stream carries that a regex should never see:
/// CSI, OSC (also unterminated, at a chunk boundary), DCS, and lone C1
/// escapes (the letter after ESC is part of the sequence, not text).
static ANSI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
          \x1b\[[0-9;:?]*[ -/]*[@-~]                 # CSI … final byte
        | \x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?         # OSC … BEL/ST
        | \x1bP[^\x1b]*(?:\x1b\\)?                   # DCS … ST
        | \x1b[@-Z^_]                                # other C1 escapes
        ",
    )
    .expect("static regex")
});

/// Append a chunk of PTY output to the match window with terminal semantics
/// applied: escape sequences and non-printing controls dropped, and a bare
/// carriage return *overwriting* the current line (progress bars, spinners)
/// rather than concatenating onto it — so line-shaped regexes see roughly
/// what a human sees. `pending_cr` carries a chunk-final `\r` into the next
/// call, where the following character decides between a newline (CRLF) and
/// an overwrite.
fn append_cooked(window: &mut String, pending_cr: &mut bool, raw: &str) {
    for c in ANSI.replace_all(raw, "").chars() {
        if std::mem::take(pending_cr) && c != '\n' {
            // Carriage return not followed by newline: rewind to line start.
            window.truncate(window.rfind('\n').map_or(0, |i| i + 1));
        }
        match c {
            '\r' => *pending_cr = true,
            '\n' | '\t' => window.push(c),
            c if !c.is_control() => window.push(c),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_id_prefers_exact_then_unique_prefix() {
        let ids = ["abc-123", "abd-456", "abc"];
        // Exact match wins even when it's also a prefix of another id.
        assert_eq!(match_id(ids.iter().copied(), "abc").unwrap(), "abc");
        assert_eq!(match_id(ids.iter().copied(), "abd").unwrap(), "abd-456");
        assert_eq!(match_id(ids.iter().copied(), "abc-").unwrap(), "abc-123");
        let err = match_id(ids.iter().copied(), "ab").unwrap_err();
        assert!(err.contains("ambiguous"), "{err}");
        assert!(match_id(ids.iter().copied(), "zzz").is_err());
    }

    #[test]
    fn encode_key_covers_the_documented_names() {
        assert_eq!(encode_key("enter").unwrap(), b"\r");
        assert_eq!(encode_key("Tab").unwrap(), b"\t");
        assert_eq!(encode_key("esc").unwrap(), b"\x1b");
        assert_eq!(encode_key("up").unwrap(), b"\x1b[A");
        assert_eq!(encode_key("ctrl-c").unwrap(), vec![0x03]);
        assert_eq!(encode_key("C-d").unwrap(), vec![0x04]);
        assert!(encode_key("ctrl-1").is_err());
        assert!(encode_key("f13").is_err());
    }

    /// Feed chunks through `append_cooked` as the stream loop would.
    fn cooked(chunks: &[&str]) -> String {
        let mut window = String::new();
        let mut pending_cr = false;
        for chunk in chunks {
            append_cooked(&mut window, &mut pending_cr, chunk);
        }
        window
    }

    #[test]
    fn cooked_output_drops_escapes_and_keeps_text() {
        // CSI colors, OSC title, CRLF line endings, erase-line.
        assert_eq!(
            cooked(&["\x1b]0;title\x07\x1b[1;32mhello\x1b[0m\r\nworld\x1b[2K"]),
            "hello\nworld"
        );
        // An OSC left unterminated by a chunk boundary is still dropped.
        assert_eq!(cooked(&["ok\x1b]133;A"]), "ok");
        // Tabs survive.
        assert_eq!(cooked(&["a\tb"]), "a\tb");
    }

    #[test]
    fn cooked_output_applies_carriage_return_overwrites() {
        // Progress-style output: each \r rewinds to the line start, so only
        // the final state remains — what a human sees on screen.
        assert_eq!(cooked(&["progress 1\rprogress 2\rdone\r\n"]), "done\n");
        // A chunk-final \r followed by \n is an ordinary CRLF...
        assert_eq!(cooked(&["abc\r", "\ndef"]), "abc\ndef");
        // ...but followed by text it overwrites, even across the boundary.
        assert_eq!(cooked(&["abc\r", "xy"]), "xy");
        // Earlier completed lines are never touched.
        assert_eq!(cooked(&["line1\r\nspin\rok\r\n"]), "line1\nok\n");
    }

    #[test]
    fn send_and_wait_parse_the_flattened_target_id() {
        use clap::Parser;
        let cli = crate::cli::Cli::try_parse_from([
            "review", "terminal", "send", "abc", "hi there", "--enter",
        ])
        .unwrap();
        let Some(crate::cli::Commands::Terminal(t)) = cli.command else {
            panic!("expected the terminal subcommand");
        };
        let TerminalAction::Send(send) = t.action else {
            panic!("expected send");
        };
        assert_eq!(send.target.id, "abc");
        assert_eq!(send.text.as_deref(), Some("hi there"));
        assert!(send.enter);
    }
}

/// Integration coverage against a real daemon. `serve` needs the `daemon`
/// feature, which the test matrix always enables alongside `cli`.
#[cfg(all(test, feature = "daemon"))]
mod daemon_tests {
    use super::*;
    use crate::daemon::test_support::{start_op, Harness, TIMEOUT};

    /// Start a `/bin/sh` session rooted in the harness temp dir.
    async fn start_session(harness: &Harness, client: &DaemonClient, id: &str) {
        let _: TerminalSummary = request(client, start_op(id, harness.dir.path()))
            .await
            .unwrap();
    }

    /// Spawn `wait_for` as a task, give it time to subscribe, then type
    /// `line` into the session and return the wait's outcome.
    async fn wait_after(
        client: &DaemonClient,
        id: &str,
        pattern: Option<&str>,
        line: &str,
    ) -> WaitOutcome {
        let regex = pattern.map(|p| Regex::new(p).unwrap());
        let waiter = tokio::spawn({
            let client = client.clone();
            let id = id.to_owned();
            async move { wait_for(&client, &id, None, regex.as_ref()).await }
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        client
            .write(id, format!("{line}\r").as_bytes())
            .await
            .unwrap();
        tokio::time::timeout(TIMEOUT, waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn wait_matches_new_output() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "t-match").await;

        let outcome = wait_after(&client, "t-match", Some("marker-[0-9]+"), "echo marker-42").await;
        match outcome {
            WaitOutcome::Matched(line) => assert!(line.contains("marker-42"), "{line}"),
            other => panic!("expected a match, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn wait_until_exit_sees_the_shell_leave() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "t-exit").await;

        let outcome = wait_after(&client, "t-exit", None, "exit 0").await;
        assert!(
            matches!(outcome, WaitOutcome::Exited(_)),
            "expected an exit, got {outcome:?}"
        );
    }

    #[tokio::test]
    async fn resolve_id_accepts_a_unique_prefix() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "reviewer-1").await;
        start_session(&harness, &client, "builder-1").await;

        assert_eq!(resolve_id(&client, "rev").await.unwrap(), "reviewer-1");
        assert!(resolve_id(&client, "nope").await.is_err());
    }
}
